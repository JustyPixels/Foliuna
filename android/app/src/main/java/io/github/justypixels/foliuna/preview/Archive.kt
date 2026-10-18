package io.github.justypixels.foliuna.preview

import android.system.Os
import android.system.ErrnoException
import android.system.OsConstants
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import org.json.JSONArray
import org.json.JSONObject
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.File
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

class Database(file: File) : AutoCloseable {
    private val connection: SQLiteConnection = BundledSQLiteDriver().open(file.path)
    private val lock = ReentrantLock(true)
    init {
        exec("PRAGMA foreign_keys=ON"); exec("PRAGMA busy_timeout=5000")
        val version = rows("PRAGMA user_version").first().getLong("user_version")
        if (version !in listOf(0L, 3L)) fail("SCHEMA", "This database version is unsupported. It was preserved.")
        if (version == 0L) transaction {
            val schema = """
              CREATE TABLE assets(id INTEGER PRIMARY KEY,sha256 TEXT NOT NULL UNIQUE CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),relative_path TEXT NOT NULL UNIQUE,byte_size INTEGER NOT NULL CHECK(byte_size>=0),created_at TEXT NOT NULL);
              CREATE TABLE source_posts(id INTEGER PRIMARY KEY,asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 64 AND provider NOT GLOB '*[^a-z0-9-]*'),post_id INTEGER NOT NULL CHECK(post_id>0),source_url TEXT NOT NULL,metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),captured_at TEXT NOT NULL,UNIQUE(provider,post_id));
              CREATE TABLE tags(id INTEGER PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,UNIQUE(name,category));
              CREATE TABLE post_tags(source_post_id INTEGER NOT NULL REFERENCES source_posts(id) ON DELETE CASCADE,tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(source_post_id,tag_id));
              CREATE INDEX post_tags_by_tag ON post_tags(tag_id,source_post_id);
              CREATE TABLE collections(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE CHECK(length(trim(name))>0));
              CREATE TABLE collection_assets(collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,PRIMARY KEY(collection_id,asset_id));
              CREATE TABLE download_journal(id TEXT PRIMARY KEY,phase TEXT NOT NULL CHECK(phase IN ('downloading','prepared')),payload_json TEXT NOT NULL CHECK(json_valid(payload_json)));
              CREATE TABLE source_snapshots(id INTEGER PRIMARY KEY,capture_id TEXT NOT NULL UNIQUE,source_post_id INTEGER NOT NULL REFERENCES source_posts(id) ON DELETE CASCADE,metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),tags_json TEXT NOT NULL CHECK(json_valid(tags_json)),captured_at TEXT NOT NULL);
              PRAGMA user_version=3;
            """.trimIndent()
            schema.split(';').filter { it.isNotBlank() }.forEach { exec(it) }
        }
        exec("PRAGMA journal_mode=WAL"); exec("PRAGMA synchronous=FULL")
    }
    fun rows(sql: String, vararg args: Any?): List<JSONObject> = lock.withLock {
        connection.prepare(sql).use { statement ->
            args.forEachIndexed { index, value -> when (value) { null -> statement.bindNull(index + 1); is Number -> statement.bindLong(index + 1, value.toLong()); else -> statement.bindText(index + 1, value.toString()) } }
            val result = ArrayList<JSONObject>()
            while (statement.step()) {
                val row = JSONObject()
                for (index in 0 until statement.getColumnCount()) row.put(statement.getColumnName(index), when (statement.getColumnType(index)) { 1 -> statement.getLong(index); 2 -> statement.getDouble(index); 3 -> statement.getText(index); 4 -> fail("STORAGE", "Unexpected database value."); else -> JSONObject.NULL })
                result.add(row)
            }
            result
        }
    }
    fun exec(sql: String, vararg args: Any?) { rows(sql, *args) }
    fun <T> transaction(action: () -> T): T = lock.withLock { exec("BEGIN IMMEDIATE"); try { val result = action(); exec("COMMIT"); result } catch (error: Exception) { exec("ROLLBACK"); throw error } }
    fun <T> access(action: () -> T): T = lock.withLock(action)
    override fun close() = lock.withLock { connection.close() }
}

fun portable(value: Any): Any = when (value) {
    is JSONObject -> JSONObject().apply { value.keys().forEach { key -> if (!Regex("api_?key|authorization|password|access_?token|token|secret|login", RegexOption.IGNORE_CASE).matches(key)) put(key, portable(value.get(key))) } }
    is JSONArray -> a(value.values().map { portable(it) })
    is String -> if (value.startsWith("https://", true) || value.startsWith("http://", true)) try {
        val url = value.toHttpUrlOrNull()
        if (url == null) value else url.newBuilder().username("").password("").apply {
            if (url.host in listOf("static1.e621.net", "static2.e621.net")) { query(null); fragment(null) }
            url.queryParameterNames.filter { Regex("api_?key|authorization|password|access_?token|token|secret|login", RegexOption.IGNORE_CASE).matches(it) }.forEach { removeAllQueryParameters(it) }
        }.build().toString()
    } catch (_: Exception) { value } else value
    else -> value
}

class Archive(val root: File, private val snapshot: (String, Long) -> Snapshot, private val transfer: MediaTransfer) : AutoCloseable {
    val db: Database
    val operation = ReentrantLock(true)
    val cancelled = AtomicBoolean(false)
    @Volatile var busy = false; private set
    @Volatile var issue: String? = null; private set
    private val storage = File(root, ".foliuna")
    private var collectionStamp = ""
    init {
        listOf(root, File(root, "media"), storage, File(storage, "staging"), File(storage, "thumbnails")).forEach { it.mkdirs(); if (!it.isDirectory || it.canonicalFile != it.absoluteFile) fail("STORAGE", "Archive folders are unsafe.") }
        db = Database(File(storage, "library.sqlite"))
        try { recover() } catch (error: Exception) { issue = (error as? Failure)?.message ?: "Archive recovery could not complete. Export a backup before reinstalling." }
    }
    fun status() = j("assets" to db.rows("SELECT count(*) AS n FROM assets").first().getLong("n"), "schemaVersion" to 3, "demo" to false, "root" to "On this Android device", "issue" to issue)
    fun <T> maintain(action: () -> T): T {
        if (!operation.tryLock()) fail("BUSY", "Wait for the current archive operation.")
        busy = true
        try { cancelled.set(false); return action() } finally { busy = false; operation.unlock() }
    }
    fun download(input: JSONObject): JSONObject = maintain {
        if (issue != null) fail("RECOVERY", issue!!)
        val site = provider(input.opt("provider")); val id = integer(input.opt("id")); val capture = UUID.randomUUID().toString()
        val stage = File(storage, "staging/$capture.part")
        val plan = j("captureId" to capture, "provider" to site, "postId" to id, "capturedAt" to Instant.now().toString(), "stage" to "$capture.part")
        db.exec("INSERT INTO download_journal(id,phase,payload_json) VALUES(?,'downloading',?)", capture, plan.toString())
        var prepared = false
        try {
            val value = snapshot(site, id); val post = value.post
            checkInput(categories.all { post.getJSONObject("tags").getJSONArray(it).length() <= 2000 }, "This source exceeds portable tag limits.")
            if (db.rows("SELECT count(*) n FROM source_snapshots c JOIN source_posts s ON s.id=c.source_post_id WHERE s.provider=? AND s.post_id=?", site, id).first().getLong("n") >= 1000) fail("LIMIT", "This source reached the portable capture-history limit. Earlier captures were preserved.")
            if (post.optBoolean("unavailable") || post.opt("originalUrl") !is String) fail("UNAVAILABLE", "This original is unavailable.")
            val file = post.getJSONObject("file"); val extension = file.text("extension"); checkInput(extension in mediaTypes)
            val bytes = transfer.save(post.getString("originalUrl"), post.getJSONObject("source"), stage, MAX_ORIGINAL, cancelled, file.optLong("size"), file.opt("md5") as? String)
            val hash = hashFile(stage); val metadata = obj(portable(value.metadata)); metadata.getJSONObject("file").put("size", bytes)
            metadata.put("tags", post.getJSONObject("tags").copy())
            plan.put("sha256", hash).put("bytes", bytes).put("extension", extension).put("metadata", metadata)
            val previous = db.rows("SELECT a.sha256 FROM source_posts s JOIN assets a ON a.id=s.asset_id WHERE s.provider=? AND s.post_id=?", site, id).firstOrNull()
            if (previous != null && previous.text("sha256") != hash) fail("REVISION", "This source now has different original bytes. The earlier archive was preserved.")
            if (previous == null && db.rows("SELECT count(*) n FROM source_posts s JOIN assets a ON a.id=s.asset_id WHERE a.sha256=?", hash).first().getLong("n") >= 100) fail("LIMIT", "This asset reached the portable source-history limit. Existing originals were preserved.")
            db.exec("UPDATE download_journal SET phase='prepared',payload_json=? WHERE id=?", plan.toString(), capture); prepared = true
            val duplicate = db.rows("SELECT id FROM assets WHERE sha256=?", hash).isNotEmpty()
            finish(plan); j("sha256" to hash, "relativePath" to "media/$hash.$extension", "duplicate" to duplicate)
        } catch (error: Exception) {
            if (!prepared) { stage.delete(); db.exec("DELETE FROM download_journal WHERE id=?", capture) }
            else issue = "An archived transfer needs recovery. Restart Foliuna to retry; existing originals are preserved."
            throw error
        }
    }
    fun recover() {
        db.rows("SELECT id,phase,payload_json FROM download_journal").forEach { row ->
            val plan = JSONObject(row.text("payload_json")); val capture = row.text("id")
            checkInput(Regex("[a-f0-9-]{36}").matches(capture) && plan.text("captureId") == capture && plan.text("stage") == "$capture.part")
            if (row.text("phase") == "downloading") { File(storage, "staging/$capture.part").delete(); db.exec("DELETE FROM download_journal WHERE id=?", capture) } else finish(plan)
        }
        issue = null
    }
    private fun finish(plan: JSONObject) {
        val hash = sha(plan.opt("sha256")); val bytes = integer(plan.opt("bytes"), MAX_ORIGINAL); val extension = plan.text("extension"); checkInput(extension in mediaTypes)
        val capture = plan.text("captureId"); checkInput(Regex("[a-f0-9-]{36}").matches(capture) && plan.text("stage") == "$capture.part")
        val site = provider(plan.opt("provider")); val id = integer(plan.opt("postId")); val metadata = plan.getJSONObject("metadata")
        val destination = File(root, "media/$hash.$extension"); val stage = File(storage, "staging/$capture.part")
        val existing = db.rows("SELECT relative_path FROM assets WHERE sha256=?", hash).firstOrNull()
        val path = existing?.text("relative_path") ?: "media/$hash.$extension"
        val target = File(root, path)
        if (!target.exists()) {
            verify(stage, hash, bytes, extension)
            try { Os.link(stage.path, target.path) } catch (error: ErrnoException) {
                if (error.errno !in listOf(OsConstants.EEXIST, OsConstants.EACCES, OsConstants.EPERM, OsConstants.ENOSYS, OsConstants.EXDEV, OsConstants.EOPNOTSUPP)) throw error
                if (error.errno != OsConstants.EEXIST) {
                    try { java.nio.file.Files.copy(stage.toPath(), target.toPath()); java.io.FileOutputStream(target, true).use { it.fd.sync() } }
                    catch (_: java.nio.file.FileAlreadyExistsException) { /* Validate the existing original below. */ }
                }
            }
        }
        verify(target, hash, bytes, path.substringAfterLast('.'))
        val source = metadata.getJSONObject("foliuna_source")
        val whenCaptured = plan.text("capturedAt"); Instant.parse(whenCaptured)
        db.transaction {
            db.exec("INSERT OR IGNORE INTO assets(sha256,relative_path,byte_size,created_at) VALUES(?,?,?,?)", hash, path, bytes, whenCaptured)
            val asset = db.rows("SELECT id FROM assets WHERE sha256=?", hash).first().getLong("id")
            val previous = db.rows("SELECT asset_id FROM source_posts WHERE provider=? AND post_id=?", site, id).firstOrNull()
            if (previous != null && previous.getLong("asset_id") != asset) fail("REVISION", "The earlier source revision was preserved.")
            db.exec("INSERT OR IGNORE INTO source_posts(asset_id,provider,post_id,source_url,metadata_json,captured_at) VALUES(?,?,?,?,?,?)", asset, site, id, Policy.postUrl(source, id), metadata.toString(), whenCaptured)
            val post = db.rows("SELECT id FROM source_posts WHERE provider=? AND post_id=?", site, id).first().getLong("id")
            if (db.rows("SELECT id FROM source_snapshots WHERE capture_id=?", capture).isEmpty()) {
                db.exec("UPDATE source_posts SET metadata_json=?,captured_at=? WHERE id=?", metadata.toString(), whenCaptured, post)
                db.exec("DELETE FROM post_tags WHERE source_post_id=?", post)
                val tags = metadata.getJSONObject("tags")
                categories.forEach { category -> tags.getJSONArray(category).values().distinct().forEach { tag ->
                    db.exec("INSERT OR IGNORE INTO tags(name,category) VALUES(?,?)", tag, category)
                    db.exec("INSERT OR IGNORE INTO post_tags(source_post_id,tag_id) SELECT ?,id FROM tags WHERE name=? AND category=?", post, tag, category)
                } }
                db.exec("INSERT INTO source_snapshots(capture_id,source_post_id,metadata_json,tags_json,captured_at) VALUES(?,?,?,?,?)", capture, post, metadata.toString(), tags.toString(), whenCaptured)
            }
        }
        writeSidecar(hash)
        db.exec("DELETE FROM download_journal WHERE id=?", capture); stage.delete()
    }
    fun verify(file: File, hash: String, bytes: Long, extension: String) {
        if (!file.isFile || file.canonicalFile != file.absoluteFile || file.length() != bytes || bytes !in 1..MAX_ORIGINAL || !file.inputStream().use { signature(it.readBytesBoundedPrefix(24), extension) } || hashFile(file) != hash) fail("INTEGRITY", "An original is missing or failed its integrity check. It was preserved.")
    }
    fun asset(hash: String): JSONObject = db.rows("SELECT * FROM assets WHERE sha256=?", sha(hash)).firstOrNull() ?: fail("NOT_FOUND", "This saved item is not in the archive.")
    fun original(hash: String): File {
        val row = asset(hash); val path = row.text("relative_path"); checkInput(Regex("media/${sha(hash)}\\.(jpg|jpeg|png|gif|webp|webm|mp4|swf)").matches(path))
        return File(root, path).also { verify(it, hash, row.getLong("byte_size"), path.substringAfterLast('.')) }
    }
    fun sidecar(hash: String): JSONObject {
        val asset = asset(hash)
        val sources = db.rows("SELECT * FROM source_posts WHERE asset_id=? ORDER BY provider,post_id", asset.getLong("id")).map { row ->
            j("provider" to row.text("provider"), "postId" to row.getLong("post_id"), "url" to row.text("source_url"), "snapshots" to a(db.rows("SELECT * FROM source_snapshots WHERE source_post_id=? ORDER BY captured_at,id", row.getLong("id")).map { capture -> j("capturedAt" to capture.text("captured_at"), "metadata" to JSONObject(capture.text("metadata_json")), "categorizedTags" to JSONObject(capture.text("tags_json"))) }))
        }
        return j("schemaVersion" to 1, "asset" to j("sha256" to hash, "byteSize" to asset.getLong("byte_size"), "mediaFile" to asset.text("relative_path").substringAfterLast('/')), "sources" to a(sources))
    }
    fun writeSidecar(hash: String) {
        val value = sidecar(hash); val file = File(root, asset(hash).text("relative_path") + ".foliuna.json")
        if (file.exists()) {
            val old = readJson(file)
            checkInput(old.optInt("schemaVersion") == 1 && old.getJSONObject("asset").text("sha256") == hash, "A conflicting sidecar was preserved.")
            old.getJSONArray("sources").values().forEach { item ->
                val source = obj(item); val next = value.getJSONArray("sources").values().map { obj(it) }.find { it.text("provider") == source.text("provider") && it.getLong("postId") == source.getLong("postId") }
                if (next == null || source.getJSONArray("snapshots").values().any { capture -> next.getJSONArray("snapshots").values().none { it.toString() == capture.toString() } }) fail("CONFLICT", "Unknown sidecar history was preserved.")
            }
        }
        atomicJson(file, value)
    }
    private fun filter(input: JSONObject): Pair<String, List<Any>> {
        val clauses = ArrayList<String>(); val args = ArrayList<Any>()
        val terms = (if (input.getBoolean("safeOnly")) safeTags(input.text("tags")) else input.text("tags")).split(Regex("\\s+")).filter { it.isNotEmpty() }
        terms.forEach { term ->
            val exclude = term.startsWith('-'); val token = if (exclude) term.drop(1) else term
            val kind = if (token.contains(':')) token.substringBefore(':').lowercase() else ""; val value = token.substringAfter(':')
            checkInput(value.isNotEmpty() && !token.startsWith('~') && !token.contains('*') && !token.contains('?'), "Gallery uses exact tags and supported filters.")
            fun like(s: String) = "%" + s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            val sql = when (kind) {
                "rating" -> { checkInput(value in listOf("s", "q", "e")); args.add(value); "json_extract(s.metadata_json,'$.rating')=?" }
                "provider" -> { args.add(provider(value)); "s.provider=?" }
                "id" -> { args.add(integer(value.toLongOrNull())); "s.post_id=?" }
                "type" -> { args.add(value.lowercase()); "json_extract(s.metadata_json,'$.file.ext')=?" }
                "source" -> { args.add(like(value)); args.add(like(value)); "(s.source_url LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM json_each(s.metadata_json,'$.sources') x WHERE x.type='text' AND x.value LIKE ? ESCAPE '\\'))" }
                else -> { checkInput(kind.isEmpty() || kind in categories, "Unknown gallery filter."); args.add(value); if (kind.isNotEmpty()) args.add(kind); "EXISTS(SELECT 1 FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.source_post_id=s.id AND t.name=?${if (kind.isNotEmpty()) " AND t.category=?" else ""})" }
            }
            clauses.add(if (exclude) "NOT ($sql)" else "($sql)")
        }
        if (input.has("collectionId")) {
            val id = input.getLong("collectionId"); val file = loadCollections(); if (file.getJSONArray("collections").values().none { obj(it).getLong("id") == id }) fail("NOT_FOUND", "This collection no longer exists.")
            clauses.add("EXISTS(SELECT 1 FROM collection_assets ca WHERE ca.collection_id=? AND ca.asset_id=s.asset_id)"); args.add(id)
        }
        return Pair(clauses.joinToString(" AND ").ifEmpty { "1" }, args)
    }
    fun search(value: JSONObject): JSONObject = db.access {
        val input = query(value, true); val (where, args) = filter(input)
        val rows = db.rows("WITH matching AS (SELECT s.*,row_number() OVER(PARTITION BY asset_id ORDER BY captured_at DESC,id DESC) rn FROM source_posts s WHERE $where) SELECT a.sha256,s.* FROM matching s JOIN assets a ON a.id=s.asset_id WHERE rn=1 ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?", *(args + 25L + ((input.getLong("page") - 1) * 24)).toTypedArray())
        j("posts" to a(rows.take(24).map { post(it) }), "page" to input.getLong("page"), "hasMore" to (rows.size > 24))
    }
    fun getPost(input: JSONObject): JSONObject = db.access {
        val hash = sha(input.opt("sha256")); val site = provider(input.opt("provider")); val id = integer(input.opt("id"))
        post(db.rows("SELECT a.sha256,s.* FROM assets a JOIN source_posts s ON s.asset_id=a.id WHERE a.sha256=? AND s.provider=? AND s.post_id=?", hash, site, id).firstOrNull() ?: fail("NOT_FOUND", "This saved source is unavailable."))
    }
    private fun post(row: JSONObject): JSONObject {
        val hash = row.text("sha256"); val metadata = JSONObject(row.text("metadata_json")); val source = metadata.getJSONObject("foliuna_source")
        val result = normalized(metadata, source.copy().put("engine", "e621")).post.put("source", source)
        if (metadata.has("source_rating")) result.put("sourceRating", metadata.text("source_rating"))
        var missing = false; try { val asset = asset(hash); val file = File(root, asset.text("relative_path")); missing = !file.isFile || file.canonicalFile != file.absoluteFile || file.length() != asset.getLong("byte_size") } catch (_: Exception) { missing = true }
        val original = if (missing) null else "https://localhost/foliuna/gallery/$hash/original"
        val thumbnail = "https://localhost/foliuna/gallery/$hash/thumbnail"
        val provenance = db.rows("SELECT provider,post_id FROM source_posts WHERE asset_id=? ORDER BY provider,post_id", row.getLong("asset_id")).map { j("provider" to it.text("provider"), "id" to it.getLong("post_id")) }
        result.getJSONObject("file").put("url", original ?: JSONObject.NULL)
        return result.put("originalUrl", original ?: JSONObject.NULL).put("sampleUrl", if (result.getJSONObject("file").text("extension") in listOf("webm", "mp4", "swf")) thumbnail else original ?: thumbnail).put("previewUrl", thumbnail).put("unavailable", missing)
            .put("archive", j("sha256" to hash, "capturedAt" to row.text("captured_at"), "sourceCount" to provenance.size, "missing" to missing, "provenance" to a(provenance)))
    }
    fun tags(prefix: String): JSONArray {
        checkInput(prefix.length in 2..80 && !Regex("[\\s\\x00-\\x1f\\x7f]").containsMatchIn(prefix))
        return a(db.rows("SELECT t.name,t.category,count(DISTINCT s.asset_id) n FROM tags t JOIN post_tags p ON p.tag_id=t.id JOIN source_posts s ON s.id=p.source_post_id WHERE t.name LIKE ? ESCAPE '\\' GROUP BY t.name,t.category ORDER BY n DESC,t.name LIMIT 8", prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%").map { j("name" to it.text("name"), "category" to categories.indexOf(it.text("category")), "count" to it.getLong("n")) })
    }
    fun cacheThumbnail(input: JSONObject) {
        val hash = sha(input.opt("sha256")); asset(hash)
        val encoded = input.text("png"); checkInput(encoded.length <= 2800000)
        val bytes = try { android.util.Base64.decode(encoded, android.util.Base64.NO_WRAP) } catch (_: Exception) { fail("INVALID_INPUT", "Invalid thumbnail.") }
        checkInput(bytes.size in 24..(2 * 1024 * 1024) && signature(bytes, "png") && String(bytes, 12, 4) == "IHDR")
        val buffer = java.nio.ByteBuffer.wrap(bytes); checkInput(buffer.getInt(16) in 1..512 && buffer.getInt(20) in 1..512)
        atomic(File(storage, "thumbnails/$hash.png"), bytes)
    }
    fun thumbnail(hash: String): File { asset(hash); return File(storage, "thumbnails/${sha(hash)}.png").also { if (!it.isFile || it.canonicalFile != it.absoluteFile || it.length() > 2 * 1024 * 1024 || !it.inputStream().use { stream -> signature(stream.readBytesBoundedPrefix(24), "png") }) fail("NOT_FOUND", "No thumbnail cached.") } }
    fun loadCollections(): JSONObject = db.access {
        val file = File(storage, "collections.json")
        val value = if (file.exists()) readJson(file) else j("schemaVersion" to 1, "nextId" to 1, "collections" to JSONArray())
        checkInput(value.optInt("schemaVersion") == 1, "Unsupported collection snapshot. It was preserved.")
        val entries = value.getJSONArray("collections"); checkInput(entries.length() <= 500); val ids = HashSet<Long>(); val names = HashSet<String>(); var count = 0
        entries.values().forEach { entry -> val item = obj(entry); checkInput(ids.add(integer(item.opt("id"))) && names.add(collectionName(item.opt("name")).lowercase())); val hashes = item.getJSONArray("assets").values().map { sha(it) }; count += hashes.size; checkInput(hashes.size <= 10000 && hashes.distinct().size == hashes.size) }
        checkInput(count <= 100000 && integer(value.opt("nextId")) > (ids.maxOrNull() ?: 0))
        val stamp = "${file.lastModified()}:${file.length()}:${db.rows("SELECT count(*) n FROM assets").first().getLong("n")}"
        if (stamp != collectionStamp) { project(value); collectionStamp = stamp }
        value
    }
    private fun project(value: JSONObject) = db.transaction {
        db.exec("DELETE FROM collection_assets"); db.exec("DELETE FROM collections")
        value.getJSONArray("collections").values().forEach { entry -> val item = obj(entry); db.exec("INSERT INTO collections(id,name) VALUES(?,?)", item.getLong("id"), item.text("name")); item.getJSONArray("assets").values().forEach { hash -> db.exec("INSERT INTO collection_assets(collection_id,asset_id) SELECT ?,id FROM assets WHERE sha256=?", item.getLong("id"), hash) } }
    }
    fun collections(contains: String? = null): JSONArray = db.access {
        val file = loadCollections()
        a(file.getJSONArray("collections").values().map { value -> val item = obj(value); val count = db.rows("SELECT count(*) n FROM collection_assets WHERE collection_id=?", item.getLong("id")).first().getLong("n"); j("id" to item.getLong("id"), "name" to item.text("name"), "assets" to count, "pending" to (item.getJSONArray("assets").length() - count)).apply { if (contains != null) put("contains", item.getJSONArray("assets").values().contains(sha(contains))) } })
    }
    fun changeCollection(action: String, input: JSONObject): JSONArray = maintain { db.access {
        val file = loadCollections(); val items = file.getJSONArray("collections").values().map { obj(it) }.toMutableList()
        val item = if (action == "create") null else (items.find { it.getLong("id") == integer(input.opt("id")) } ?: fail("NOT_FOUND", "Collection not found."))
        when (action) {
            "create", "rename" -> {
                val name = collectionName(input.opt("name")); checkInput(items.none { it !== item && it.text("name").equals(name, true) }, "A collection with that name already exists.")
                if (action == "create") { checkInput(items.size < 500); val id = file.getLong("nextId"); items.add(j("id" to id, "name" to name, "assets" to JSONArray())); file.put("nextId", id + 1) } else item!!.put("name", name)
            }
            "delete" -> items.remove(item)
            "membership" -> {
                val hash = sha(input.opt("sha256")); checkInput(input.opt("present") is Boolean); asset(hash)
                val hashes = item!!.getJSONArray("assets").values().map { it.toString() }.toMutableSet()
                if (input.getBoolean("present")) hashes.add(hash) else hashes.remove(hash)
                checkInput(hashes.size <= 10000); item.put("assets", a(hashes.sorted()))
            }
            else -> fail("INVALID_INPUT", "Invalid collection action.")
        }
        checkInput(items.sumOf { it.getJSONArray("assets").length() } <= 100000)
        file.put("collections", a(items)); atomicJson(File(storage, "collections.json"), file); collectionStamp = ""; collections()
    } }
    fun exportFiles(copy: (String, File) -> Unit): Int = maintain { db.access {
        val assets = db.rows("SELECT * FROM assets ORDER BY sha256")
        assets.forEach { row ->
            if (cancelled.get()) fail("CANCELLED", "Export stopped. Your archive is unchanged.")
            val hash = row.text("sha256"); val original = original(hash); writeSidecar(hash)
            copy(row.text("relative_path"), original); copy(row.text("relative_path") + ".foliuna.json", File(root, row.text("relative_path") + ".foliuna.json"))
        }
        val collections = loadCollections(); atomicJson(File(storage, "collections.json"), collections); copy(".foliuna/collections.json", File(storage, "collections.json"))
        assets.size
    } }
    fun reconcile(): JSONObject = maintain {
        var missing = 0; var invalid = 0; var checked = 0; val issues = ArrayList<JSONObject>()
        db.rows("SELECT sha256 FROM assets").forEach { row ->
            if (cancelled.get()) fail("CANCELLED", "Library check stopped.")
            checked++; try { original(row.text("sha256")); writeSidecar(row.text("sha256")) } catch (error: Exception) { if (File(root, asset(row.text("sha256")).text("relative_path")).exists()) invalid++ else missing++; if (issues.size < 50) issues.add(j("file" to asset(row.text("sha256")).text("relative_path"), "message" to ((error as? Failure)?.message ?: "File check failed."))) }
        }
        j("checked" to checked, "imported" to 0, "recovered" to 0, "missing" to missing, "invalid" to invalid, "conflicts" to 0, "issues" to a(issues))
    }
    override fun close() { cancelled.set(true); operation.withLock { db.close() } }
}
fun java.io.InputStream.readBytesBoundedPrefix(size: Int): ByteArray { val result = ByteArray(size); var used = 0; while (used < size) { val count = read(result, used, size - used); if (count < 0) break; used += count }; return result.copyOf(used) }
