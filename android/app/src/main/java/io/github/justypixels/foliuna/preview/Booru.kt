package io.github.justypixels.foliuna.preview

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import okhttp3.Credentials as BasicCredentials
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.InputStream
import java.net.InetAddress
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

const val MAX_ORIGINAL = 100L * 1024 * 1024
val mediaTypes = mapOf("jpg" to "image/jpeg", "jpeg" to "image/jpeg", "png" to "image/png", "gif" to "image/gif", "webp" to "image/webp", "webm" to "video/webm", "mp4" to "video/mp4", "swf" to "application/x-shockwave-flash")
fun signature(bytes: ByteArray, ext: String): Boolean {
    fun starts(vararg prefix: Int) = bytes.size >= prefix.size && prefix.indices.all { (bytes[it].toInt() and 255) == prefix[it] }
    fun text(start: Int, end: Int) = if (bytes.size >= end) String(bytes.copyOfRange(start, end), Charsets.US_ASCII) else ""
    return when (ext) {
        "jpg", "jpeg" -> starts(255, 216, 255)
        "png" -> starts(137, 80, 78, 71, 13, 10, 26, 10)
        "gif" -> text(0, 6) in listOf("GIF87a", "GIF89a")
        "webp" -> text(0, 4) == "RIFF" && text(8, 12) == "WEBP"
        "webm" -> starts(26, 69, 223, 163)
        "mp4" -> text(4, 8) == "ftyp"
        "swf" -> bytes.size >= 8 && text(0, 3) in listOf("FWS", "CWS", "ZWS") && (bytes[3].toInt() and 255) in 1..50 && java.nio.ByteBuffer.wrap(bytes, 4, 4).order(java.nio.ByteOrder.LITTLE_ENDIAN).int.toLong() in 8..MAX_ORIGINAL
        else -> false
    }
}

data class HttpResult(val status: Int, val headers: Map<String, String>, val body: InputStream, val close: () -> Unit) : AutoCloseable { override fun close() { body.close(); close.invoke() } }
fun interface Transport { fun get(url: HttpUrl, headers: Map<String, String>): HttpResult }
class PublicTransport : Transport {
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).callTimeout(120, TimeUnit.SECONDS)
        .dns(Dns { hostname ->
            val addresses = InetAddress.getAllByName(hostname).toList()
            if (addresses.isEmpty() || addresses.any { !Policy.address(it) }) fail("NETWORK", "The destination is not a public address.")
            addresses
        }).build()
    override fun get(url: HttpUrl, headers: Map<String, String>): HttpResult {
        Policy.url(url.toString())
        val builder = Request.Builder().url(url).get(); headers.forEach { (name, value) -> builder.header(name, value) }
        val response = try { client.newCall(builder.build()).execute() } catch (_: Exception) { fail("NETWORK", "Could not reach the provider. Check your connection and try again.") }
        return HttpResult(response.code, response.headers.toMultimap().mapKeys { it.key.lowercase() }.mapValues { it.value.joinToString(",") }, response.body.byteStream()) { response.close() }
    }
}
fun cooldown(headers: Map<String, String>): Long {
    val value = headers["retry-after"].orEmpty()
    val delay = value.toLongOrNull()?.takeIf { it >= 0 }?.let { it.coerceAtMost(86400) * 1000 } ?: try { ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() - System.currentTimeMillis() } catch (_: Exception) { 30000L }
    return System.currentTimeMillis() + delay.coerceIn(30000, 86400000)
}
fun httpStatus(status: Int, headers: Map<String, String>, pause: (Long) -> Unit) {
    if (status in listOf(429, 503)) { pause(cooldown(headers)); fail("RATE_LIMIT", "The provider paused requests. Wait before trying again.") }
    if (status == 401) fail("CREDENTIALS_REQUIRED", "This provider requires valid API credentials. Check Settings.")
    if (status == 403) fail("FORBIDDEN", "The provider refused access. A key may not resolve a site or network restriction.")
    if (status !in 200..299) fail("NETWORK", "The provider returned HTTP $status. No automatic retry was made.")
}

class ApiClient(private val providers: Providers, private val credentials: Credentials, private val transport: Transport = PublicTransport(), private val interval: Long = 1100) {
    private data class Cached(val bytes: ByteArray, val expires: Long)
    private val cache = LinkedHashMap<String, Cached>(); private var cacheBytes = 0
    private val inFlight = ConcurrentHashMap<String, FutureTask<ByteArray>>()
    private val pending = AtomicInteger(); private val queue = Any(); private var nextAt = 0L; private var paused = 0L; private val generation = AtomicInteger()
    private val agent = "Foliuna-Android/${BuildConfig.VERSION_NAME} (by JustyPixels; https://github.com/JustyPixels/Foliuna/issues)"
    @Synchronized fun clear() { generation.incrementAndGet(); cache.clear(); cacheBytes = 0 }
    private fun endpoint(source: JSONObject, url: HttpUrl) {
        val base = Policy.url(source.text("apiUrl")); checkInput(url.scheme == base.scheme && url.host == base.host && url.port == base.port && url.encodedPath.startsWith(base.encodedPath), "Unapproved API destination.")
        val path = url.encodedPath.removePrefix(base.encodedPath)
        val keys = url.queryParameterNames
        val allowed = when {
            source.text("id") == "rule34" && path == "autocomplete.php" -> keys.all { it == "q" }
            source.text("engine") == "gelbooru" -> path == "index.php" && url.queryParameter("page") == "dapi" && url.queryParameter("s") in listOf("post", "tag") && url.queryParameter("q") == "index" && url.queryParameter("json") == "1" && keys.all { it in listOf("page", "s", "q", "json", "tags", "pid", "limit", "id", "name_pattern", "orderby") }
            else -> (Regex("(?:posts|post)(?:/[1-9][0-9]*)?\\.json").matches(path) && keys.all { it in listOf("tags", "page", "limit") }) || (path == "tags.json" && keys.all { it in listOf("search[name_matches]", "search[order]", "limit") }) || (source.text("id") == "e621" && path == "users/me.json" && keys.isEmpty())
        }
        checkInput(allowed && url.username.isEmpty() && url.password.isEmpty() && url.fragment == null, "Unapproved API request.")
    }
    fun json(id: String, url: HttpUrl, ttl: Long = 60000, fresh: Boolean = false): Any {
        val source = providers.get(id); endpoint(source, url)
        val key = "$id|$url"; val gen = generation.get()
        if (!fresh) synchronized(this) { cache[key]?.takeIf { it.expires > System.currentTimeMillis() }?.let { return JSONTokener(String(it.bytes)).nextValue() } }
        val task = FutureTask {
            if (pending.incrementAndGet() > 4) { pending.decrementAndGet(); fail("BUSY", "Too many requests are pending. Wait for the current search.") }
            try { synchronized(queue) {
                if (System.currentTimeMillis() < paused) fail("RATE_LIMIT", "The provider paused requests. Wait before trying again.")
                val delay = nextAt - System.currentTimeMillis(); if (delay > 0) Thread.sleep(delay)
                nextAt = System.currentTimeMillis() + interval
                val saved = credentials.read(id)
                if (id == "rule34" && saved == null) fail("CREDENTIALS_REQUIRED", "Rule34 requires its numeric user ID and API key in Settings.")
                var target = url; val headers = mutableMapOf("User-Agent" to agent, "Accept" to "application/json", "Accept-Encoding" to "identity")
                if (saved != null && source.text("auth") == "basic") headers["Authorization"] = BasicCredentials.basic(saved.getString("username"), saved.getString("apiKey"), Charsets.UTF_8)
                if (saved != null && source.text("auth") == "query") target = target.newBuilder().addQueryParameter("user_id", saved.getString("username")).addQueryParameter("api_key", saved.getString("apiKey")).build()
                transport.get(target, headers).use { response ->
                    httpStatus(response.status, response.headers) { paused = it }
                    if (!response.headers["content-type"].orEmpty().substringBefore(';').trim().let { it == "application/json" || it.endsWith("+json") }) fail("INVALID_RESPONSE", "The provider did not return JSON.")
                    val body = response.body.readBytesBounded(8 * 1024 * 1024)
                    val text = String(body).removePrefix("\uFEFF")
                    val bytes = (if (text.isBlank() && id == "safebooru" && url.queryParameter("s") == "post") "[]" else text).toByteArray()
                    try { checkInput(JSONTokener(String(bytes)).nextValue() is JSONObject || JSONTokener(String(bytes)).nextValue() is JSONArray) } catch (_: Exception) { fail("INVALID_RESPONSE", "The provider returned invalid JSON.") }
                    if (!fresh && generation.get() == gen) synchronized(this) {
                        cache.remove(key)?.let { cacheBytes -= it.bytes.size }; cache[key] = Cached(bytes, System.currentTimeMillis() + ttl); cacheBytes += bytes.size
                        while (cache.size > 120 || cacheBytes > 32 * 1024 * 1024) { val first = cache.entries.first(); cacheBytes -= first.value.bytes.size; cache.remove(first.key) }
                    }
                    bytes
                }
            } } finally { pending.decrementAndGet() }
        }
        val actual = if (fresh) task else inFlight.putIfAbsent(key, task) ?: task
        try {
            if (actual === task) task.run()
            val bytes = actual.get()
            return try { JSONTokener(String(bytes)).nextValue() } catch (_: Exception) { fail("INVALID_RESPONSE", "The provider returned invalid JSON.") }
        } catch (error: java.util.concurrent.ExecutionException) { throw (error.cause as? Failure ?: Failure("NETWORK", "The request could not complete.")) }
        finally { if (!fresh && actual === task) inFlight.remove(key, task) }
    }
}
fun InputStream.readBytesBounded(limit: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(32768)
    while (true) { val count = read(buffer); if (count < 0) break; if (output.size() + count > limit) fail("LIMIT", "The response exceeded its size limit."); output.write(buffer, 0, count) }
    return output.toByteArray()
}

data class Snapshot(val post: JSONObject, val metadata: JSONObject)
interface BooruAdapter { fun search(input: JSONObject): JSONObject; fun snapshot(id: Long, fresh: Boolean = false): Snapshot; fun tags(prefix: String): JSONArray }
class CompatibleBooru(private val source: JSONObject, private val api: ApiClient) : BooruAdapter {
    private val id = source.text("id"); private val engine = source.text("engine"); private val observed = LinkedHashMap<String, Int>()
    private fun endpoint(post: Long? = null, request: JSONObject? = null): HttpUrl {
        val path = if (engine == "gelbooru") "index.php" else if (engine == "moebooru") "post.json" else "posts${post?.let { "/$it" }.orEmpty()}.json"
        val url = Policy.url(source.text("apiUrl") + path).newBuilder()
        if (engine == "gelbooru") {
            listOf("page" to "dapi", "s" to "post", "q" to "index", "json" to "1", "limit" to "24").forEach { url.addQueryParameter(it.first, it.second) }
            if (post != null) url.addQueryParameter("id", "$post") else url.addQueryParameter("pid", "${request!!.getLong("page") - 1}")
        } else if (post == null || engine == "moebooru") {
            url.addQueryParameter("limit", "24"); if (post != null) url.addQueryParameter("tags", "id:$post") else url.addQueryParameter("page", "${request!!.getLong("page")}")
        }
        if (request != null) url.addQueryParameter("tags", if (request.getBoolean("safeOnly")) safeTags(request.text("tags"), if (engine == "gelbooru" && source.text("safeRating") == "g") "general" else source.text("safeRating")) else request.text("tags"))
        return url.build()
    }
    private fun list(raw: Any): List<JSONObject> {
        val values = if (raw is JSONArray) raw else obj(raw).optJSONArray(if (engine == "e621") "posts" else "post") ?: fail("INVALID_RESPONSE", "The site did not return a supported post list.")
        if (values.length() > 24) fail("INVALID_RESPONSE", "The site returned too many posts.")
        return values.values().map { obj(it) }
    }
    override fun search(input: JSONObject): JSONObject {
        val request = query(input); checkInput(request.text("provider") == id)
        val raw = list(api.json(id, endpoint(request = request))); val posts = raw.map { normalize(it) }.map { it.post }.filter { !request.getBoolean("safeOnly") || it.text("rating") == "s" }
        return j("posts" to a(posts), "page" to request.getLong("page"), "hasMore" to (raw.size == 24 && request.getLong("page") < 750))
    }
    override fun snapshot(id: Long, fresh: Boolean): Snapshot {
        integer(id); val raw = api.json(this.id, endpoint(id), fresh = fresh)
        val value = when (engine) { "e621" -> obj(raw).getJSONObject("post"); "danbooru" -> obj(raw); else -> list(raw).firstOrNull() ?: fail("UNAVAILABLE", "This post is unavailable.") }
        val result = normalize(value); if (result.post.getLong("id") != id) fail("INVALID_RESPONSE", "The site returned a different post."); return result
    }
    private fun normalize(raw: JSONObject): Snapshot = normalized(raw, source).also { value ->
        synchronized(observed) { categories.forEach { category -> value.post.getJSONObject("tags").getJSONArray(category).values().forEach { tag -> observed[tag.toString()] = (observed[tag.toString()] ?: 0) + 1 } }; while (observed.size > 10000) observed.remove(observed.keys.first()) }
    }
    override fun tags(prefix: String): JSONArray {
        checkInput(prefix.length in 2..80 && !Regex("[\\s*?%:\\x00-\\x1f\\x7f]").containsMatchIn(prefix), "Type a tag prefix of 2–80 characters.")
        if (engine !in listOf("e621", "danbooru") && id != "rule34") return synchronized(observed) { a(observed.entries.filter { it.key.startsWith(prefix) }.sortedByDescending { it.value }.take(8).map { j("name" to it.key, "count" to it.value, "category" to 0, "recent" to true) }) }
        val url = Policy.url(source.text("apiUrl") + if (id == "rule34") "autocomplete.php" else "tags.json").newBuilder()
        if (id == "rule34") url.addQueryParameter("q", prefix) else { url.addQueryParameter("search[name_matches]", "$prefix*"); url.addQueryParameter("search[order]", "count"); url.addQueryParameter("limit", "8") }
        val values = api.json(id, url.build(), 86400000) as? JSONArray ?: fail("INVALID_RESPONSE", "Invalid tag suggestions.")
        if (values.length() > 100) fail("INVALID_RESPONSE", "Invalid tag suggestions.")
        return a(values.values().take(8).map { item -> val tag = obj(item); val name = tag.text(if (id == "rule34") "value" else "name"); checkInput(name.isNotEmpty() && name.length <= 200 && !Regex("\\s").containsMatchIn(name)); j("name" to name, "category" to tag.optInt("category", 0), "count" to tag.optLong("post_count", 0)) })
    }
}

fun normalized(raw: JSONObject, source: JSONObject): Snapshot {
    val engine = source.text("engine"); val native = engine == "e621"
    val id = integer(if (raw.opt("id") is Number) raw.opt("id") else raw.text("id").toLongOrNull())
    val sourceRating = raw.text("rating").lowercase()
    if (native && sourceRating !in listOf("s", "q", "e")) fail("INVALID_RESPONSE", "The site returned an unknown rating.")
    val rating = if (native && sourceRating in listOf("s", "q", "e")) sourceRating else when (sourceRating) {
        "g", "general", "safe" -> "s"; source.text("safeRating") -> "s"; "s", "sensitive", "q", "questionable" -> "q"; "e", "explicit" -> "e"; else -> fail("INVALID_RESPONSE", "The site returned an unknown rating.")
    }
    val tags = JSONObject()
    categories.forEach { category ->
        val value = if (native) raw.optJSONObject("tags")?.optJSONArray(category)?.values() ?: emptyList() else raw.text("tag_string_$category").split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (value.size > 10000 || value.any { it !is String || it.isEmpty() || it.length > 200 || Regex("[\\s\\x00-\\x1f\\x7f]").containsMatchIn(it) }) fail("INVALID_RESPONSE", "The site returned invalid tags.")
        tags.put(category, a(if (native || engine == "danbooru") value.distinct() else emptyList<Any>()))
    }
    if (!native) {
        val all = (if (raw.has("tag_string")) raw.text("tag_string") else raw.text("tags")).split(Regex("\\s+")).filter { it.isNotEmpty() }
        checkInput(all.size <= 10000 && all.all { it.length <= 200 })
        val seen = categories.flatMap { tags.getJSONArray(it).values() }.toSet(); tags.put("general", a(tags.getJSONArray("general").values() + all.filter { it !in seen }.distinct()))
    }
    fun resolve(value: Any?): String? {
        if (value !is String || value.isEmpty()) return null
        var input = if (value.startsWith("http:")) "https:" + value.removePrefix("http:") else value
        val knownHosts = source.getJSONArray("mediaOrigins").values().map { Policy.url(it.toString()).host } + Policy.url(source.text("baseUrl")).host
        if (knownHosts.any { input.startsWith("$it/") }) input = "https://$input"
        val base = Policy.url(source.text("baseUrl")); val url = base.resolve(input) ?: return null
        val cleaned = if (Regex("[0-9]+").matches(url.query.orEmpty())) url.newBuilder().query(null).build() else url
        return Policy.media(cleaned.toString(), source)
    }
    val file = raw.optJSONObject("file") ?: JSONObject(); val flags = raw.optJSONObject("flags") ?: JSONObject()
    val unavailable = flags.optBoolean("deleted") || flags.optBoolean("is_deleted") || raw.optBoolean("is_deleted") || raw.text("status") == "deleted"
    val directory = raw.opt("directory")?.toString().orEmpty(); val image = raw.text("image"); val fallback = engine == "gelbooru" && Regex("[a-zA-Z0-9_.-]+").matches(image) && Regex("[0-9]+").matches(directory)
    val original = if (unavailable) null else resolve(if (native) file.opt("url") else raw.opt("file_url") ?: if (fallback) "images/$directory/$image" else null)
    val ext = (if (native) file.text("ext") else raw.text("file_ext")).ifEmpty { original?.substringAfterLast('.') ?: image.substringAfterLast('.', "") }.lowercase()
    val md5 = (if (native) file.text("md5") else raw.text("md5").ifEmpty { raw.text("hash") }).lowercase().takeIf { Regex("[a-f0-9]{32}").matches(it) }
    val preview = if (unavailable) null else resolve(if (native) raw.optJSONObject("preview")?.opt("url") else raw.opt("preview_file_url") ?: raw.opt("preview_url") ?: if (fallback && md5 != null) "thumbnails/$directory/thumbnail_$md5.jpg" else null)
    val sample = if (unavailable) null else resolve(if (native) raw.optJSONObject("sample")?.opt("url") else raw.opt("large_file_url") ?: raw.opt("sample_url")) ?: if (native) null else original
    fun number(value: Any?): Long = (value as? Number)?.toLong()?.coerceAtLeast(0) ?: (value as? String)?.toLongOrNull()?.coerceAtLeast(0) ?: 0
    val width = number(if (native) file.opt("width") else raw.opt("image_width") ?: raw.opt("width")); val height = number(if (native) file.opt("height") else raw.opt("image_height") ?: raw.opt("height"))
    val bytes = number(if (native) file.opt("size") else raw.opt("file_size"))
    val sources = if (native) raw.optJSONArray("sources")?.values()?.filterIsInstance<String>() ?: emptyList() else raw.text("source").split(Regex("\\s+")).filter { it.isNotEmpty() }
    val created = if (raw.opt("created_at") is Number) Instant.ofEpochSecond(raw.getLong("created_at")).toString() else raw.text("created_at").ifEmpty { null }
    val score = if (native) raw.optJSONObject("score")?.optLong("total") ?: 0 else raw.optLong("score", 0)
    val favorites = raw.optLong("fav_count", 0)
    val metadata = if (native) raw.copy().apply { put("foliuna_source", source.copy()) } else j("id" to id, "rating" to rating, "source_rating" to sourceRating, "tags" to tags, "description" to raw.text("description"), "sources" to a(sources), "created_at" to created, "score" to j("total" to score), "fav_count" to favorites, "flags" to j("deleted" to unavailable), "file" to j("url" to original, "ext" to ext, "width" to width, "height" to height, "size" to bytes, "md5" to md5), "preview" to j("url" to preview), "sample" to j("url" to sample), "foliuna_source" to source.copy(), "provider_metadata" to raw.copy())
    return Snapshot(j("provider" to source.text("id"), "id" to id, "rating" to rating, "tags" to tags, "description" to raw.text("description"), "sources" to a(sources.take(100)), "createdAt" to created, "score" to score, "favorites" to favorites,
        "file" to j("url" to original, "extension" to ext, "width" to width, "height" to height, "size" to bytes, "md5" to md5), "previewUrl" to preview, "sampleUrl" to sample, "originalUrl" to original, "unavailable" to unavailable, "source" to source.copy(), "sourceRating" to sourceRating), metadata)
}

class MediaTransfer(private val transport: Transport = PublicTransport()) {
    @Volatile private var paused = 0L
    fun save(url: String, source: JSONObject, file: File, maximum: Long, cancelled: AtomicBoolean, expected: Long? = null, md5: String? = null): Long {
        if (System.currentTimeMillis() < paused) fail("RATE_LIMIT", "The media host paused requests. Wait before retrying.")
        if (Policy.media(url, source) == null) fail("INVALID_INPUT", "Unapproved media destination.")
        val extension = url.toHttpUrlOrNull()!!.pathSegments.last().substringAfterLast('.').lowercase()
        val started = System.nanoTime()
        transport.get(Policy.url(url), mapOf("User-Agent" to "Foliuna-Android/${BuildConfig.VERSION_NAME} (JustyPixels; https://github.com/JustyPixels/Foliuna/issues)", "Accept-Encoding" to "identity")).use { response ->
            httpStatus(response.status, response.headers) { paused = it }
            val length = response.headers["content-length"]?.toLongOrNull()
            if (length != null && (length > maximum || length < 0 || (expected != null && expected > 0 && expected != length))) fail("INVALID_MEDIA", "The media size does not match its metadata.")
            val type = response.headers["content-type"].orEmpty().substringBefore(';').trim().lowercase()
            if (type !in listOf(mediaTypes[extension], "application/octet-stream", "binary/octet-stream", "")) fail("INVALID_MEDIA", "The media host returned an unexpected file type.")
            val digest = MessageDigest.getInstance("MD5"); var size = 0L; val prefix = java.io.ByteArrayOutputStream()
            FileOutputStream(file).use { output ->
                val buffer = ByteArray(65536)
                while (true) {
                    if (cancelled.get()) fail("CANCELLED", "Download cancelled. Completed originals were preserved.")
                    if (TimeUnit.NANOSECONDS.toSeconds(System.nanoTime() - started) > 120) fail("TIMEOUT", "The media transfer timed out.")
                    val count = response.body.read(buffer); if (count < 0) break
                    size += count; if (size > maximum) fail("LIMIT", "The media exceeds the 100 MiB original or 8 MiB preview limit.")
                    if (prefix.size() < 24) prefix.write(buffer, 0, minOf(count, 24 - prefix.size()))
                    output.write(buffer, 0, count); digest.update(buffer, 0, count)
                }
                output.fd.sync()
            }
            if (!signature(prefix.toByteArray(), extension) || size == 0L || (length != null && size != length) || (expected != null && expected > 0 && size != expected)) fail("INVALID_MEDIA", "The original is incomplete or has an invalid format.")
            if (md5 != null && digest.digest().joinToString("") { "%02x".format(it) } != md5.lowercase()) fail("CHECKSUM", "The original failed its source checksum. It was not archived.")
            return size
        }
    }
}
