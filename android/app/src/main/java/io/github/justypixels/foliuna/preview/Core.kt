package io.github.justypixels.foliuna.preview

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.InetAddress
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.KeyStore
import java.security.MessageDigest
import java.text.Normalizer
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

class Failure(val code: String, override val message: String) : Exception(message)
fun fail(code: String, message: String): Nothing = throw Failure(code, message)
fun checkInput(condition: Boolean, message: String = "Invalid request.") { if (!condition) fail("INVALID_INPUT", message) }
fun obj(value: Any?): JSONObject = value as? JSONObject ?: fail("INVALID_DATA", "Expected an object.")
fun j(vararg fields: Pair<String, Any?>) = JSONObject().apply { fields.forEach { put(it.first, it.second ?: JSONObject.NULL) } }
fun a(values: Iterable<*>) = JSONArray(values.toList())
fun JSONArray.values(): List<Any> = (0 until length()).map { get(it) }
fun JSONObject.text(key: String): String = opt(key) as? String ?: ""
fun JSONObject.copy(): JSONObject = JSONObject(toString())
fun integer(value: Any?, max: Long = 9007199254740991L): Long {
    checkInput(value is Number && value.toDouble().isFinite() && value.toDouble() == value.toLong().toDouble() && value.toLong() in 1..max, "Expected a positive whole number.")
    return (value as Number).toLong()
}
fun hash(bytes: ByteArray, algorithm: String = "SHA-256"): String = MessageDigest.getInstance(algorithm).digest(bytes).joinToString("") { "%02x".format(it) }
fun hashFile(file: File, algorithm: String = "SHA-256"): String {
    val digest = MessageDigest.getInstance(algorithm)
    file.inputStream().use { input -> val buffer = ByteArray(65536); while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) } }
    return digest.digest().joinToString("") { "%02x".format(it) }
}
fun atomic(file: File, bytes: ByteArray) {
    checkInput(file.parentFile!!.canonicalFile == file.parentFile!!.absoluteFile && (!file.exists() || file.canonicalFile == file.absoluteFile), "Unsafe storage path.")
    val temp = File(file.parentFile, ".${UUID.randomUUID()}.tmp")
    try { FileOutputStream(temp).use { it.write(bytes); it.fd.sync() }; Files.move(temp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING) }
    finally { temp.delete() }
}
fun atomicJson(file: File, value: Any, limit: Int = 16 * 1024 * 1024) {
    val bytes = value.toString().toByteArray(); if (bytes.size > limit) fail("LIMIT", "Metadata is too large. Existing files were preserved."); atomic(file, bytes)
}
fun readJson(file: File, max: Long = 16 * 1024 * 1024): JSONObject {
    if (!file.isFile || file.canonicalFile != file.absoluteFile || file.length() > max) fail("STORAGE", "Invalid storage file. It was preserved.")
    return try { JSONObject(file.readText()) } catch (_: Exception) { fail("STORAGE", "Saved metadata could not be read. It was preserved.") }
}

val categories = listOf("artist", "copyright", "character", "species", "general", "meta", "lore", "invalid")
fun validTag(value: Any?): Boolean = value is String && value.length in 1..200 && value.none { it.isWhitespace() || it == '\uFEFF' || it.code < 32 || it.code == 127 }
val providerPattern = Regex("(?:e621|e926|danbooru|gelbooru|rule34|safebooru|aibooru|yandere|konachan|custom-[a-f0-9]{32})")
val shaPattern = Regex("[a-f0-9]{64}")
fun provider(value: Any?): String { checkInput(value is String && providerPattern.matches(value), "Choose a configured booru."); return value as String }
fun sha(value: Any?): String { checkInput(value is String && shaPattern.matches(value), "Invalid archived identity."); return value as String }
fun query(input: JSONObject, gallery: Boolean = false): JSONObject {
    val tags = input.opt("tags"); checkInput(tags is String && tags.length <= 512 && !Regex("[\\x00-\\x1f\\x7f]").containsMatchIn(tags), "Use a query of up to 512 characters.")
    val words = (tags as String).trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    checkInput(words.size <= 40 && (gallery || words.none { it.startsWith("limit:", true) }), "Use up to 40 search terms.")
    checkInput(!input.has("safeOnly") || input.opt("safeOnly") is Boolean, "Invalid content filter.")
    return j("tags" to tags.trim(), "page" to integer(input.opt("page"), if (gallery) 1000000 else 750), "safeOnly" to (input.opt("safeOnly") != false)).apply {
        if (!gallery) put("provider", provider(input.opt("provider")))
        if (gallery && input.has("collectionId")) put("collectionId", integer(input.opt("collectionId")))
    }
}
fun safeTags(value: String, rating: String = "s") = (value.split(Regex("\\s+")).filter { it.isNotEmpty() && !Regex("[-~]?rating:.*", RegexOption.IGNORE_CASE).matches(it) } + "rating:$rating").joinToString(" ")

object Policy {
    fun url(value: String): HttpUrl {
        checkInput(value.length <= 2048)
        val url = value.toHttpUrlOrNull() ?: fail("INVALID_INPUT", "Enter a public HTTPS URL.")
        checkInput(url.isHttps && url.port == 443 && url.username.isEmpty() && url.password.isEmpty() && url.host.contains('.') && !url.host.contains(':') &&
            !Regex("(?:^|\\.)(?:localhost|local|internal|test|invalid|example)$").containsMatchIn(url.host) && !Regex("[0-9.]+").matches(url.host), "Only public HTTPS sites are supported.")
        return url
    }
    fun address(address: InetAddress): Boolean {
        val bytes = address.address.map { it.toInt() and 255 }
        if (bytes.size == 16) {
            val text = address.hostAddress.orEmpty().lowercase()
            return bytes[0] in 0x20..0x3f && !text.startsWith("2002:") && !(bytes[0] == 0x20 && bytes[1] == 1 && ((bytes[2] == 0 && bytes[3] in listOf(0, 2, 0x10, 0x20)) || (bytes[2] == 0x0d && bytes[3] == 0xb8)))
        }
        if (bytes.size != 4) return false
        val (x, y, z) = bytes
        return !(x in listOf(0, 10, 127) || x >= 224 || (x == 100 && y in 64..127) || (x == 169 && y == 254) || (x == 172 && y in 16..31) ||
            (x == 192 && (y == 168 || (y == 0 && z in listOf(0, 2)) || (y == 88 && z == 99))) || (x == 198 && (y in listOf(18, 19) || (y == 51 && z == 100))) || (x == 203 && y == 0 && z == 113))
    }
    fun definition(raw: JSONObject, custom: Boolean): JSONObject {
        val name = raw.text("name").trim(); checkInput(name.isNotEmpty() && name.length <= 80 && name.none { it.code < 32 || it.code == 127 })
        val engine = raw.text("engine"); checkInput(engine in (if (custom) listOf("danbooru", "gelbooru") else listOf("e621", "danbooru", "gelbooru", "moebooru")))
        fun base(key: String): String { val u = url(raw.text(key)); checkInput(u.query == null && u.fragment == null && !u.encodedPath.contains('%') && !u.encodedPath.contains('\\')); return u.toString().trimEnd('/') + "/" }
        val site = base("baseUrl"); val api = base("apiUrl")
        checkInput(raw.text("auth") in listOf("basic", "query", "none") && raw.text("safeRating") in listOf("s", "g"))
        val hosts = raw.optJSONArray("mediaOrigins") ?: fail("INVALID_INPUT", "Invalid media origins.")
        checkInput(hosts.length() <= 24)
        val origins = hosts.values().map { checkInput(it is String); val u = url(it as String); checkInput(u.encodedPath == "/" && u.query == null && u.fragment == null); u.toString().trimEnd('/') }.distinct()
        val id = if (custom) "custom-" + hash(a(listOf(engine, site, api)).toString().replace("\\/", "/").toByteArray()).take(32) else provider(raw.opt("id"))
        return j("id" to id, "name" to name, "engine" to engine, "baseUrl" to site, "apiUrl" to api, "auth" to raw.text("auth"), "safeRating" to raw.text("safeRating"), "mediaOrigins" to a(origins))
    }
    fun media(value: Any?, source: JSONObject): String? {
        if (value !is String || value.isEmpty()) return null
        return try {
            val url = url(value)
            val origins = source.getJSONArray("mediaOrigins").values().map { it.toString() } + source.getString("baseUrl").toHttpUrlOrNull()!!.let { "https://${it.host}" }
            if ("https://${url.host}" !in origins || url.query != null || url.fragment != null || !Regex(".*\\.(jpg|jpeg|png|gif|webp|webm|mp4|swf)", RegexOption.IGNORE_CASE).matches(url.encodedPath)) null else url.toString()
        } catch (_: Failure) { null }
    }
    fun postUrl(source: JSONObject, id: Long): String = source.getString("baseUrl") + when (source.text("engine")) { "gelbooru" -> "index.php?page=post&s=view&id=$id"; "moebooru" -> "post/show/$id"; else -> "posts/$id" }
}

class Providers(private val folder: File, builtins: JSONArray) {
    private val builtin = builtins.values().map { Policy.definition(obj(it), false) }
    private var custom = if (File(folder, "boorus.json").exists()) readJson(File(folder, "boorus.json"), 256 * 1024).getJSONArray("providers").values().map { raw -> Policy.definition(obj(raw), true).also { checkInput(it.text("id") == obj(raw).text("id")) } } else emptyList()
    init { checkInput(custom.size <= 32 && custom.map { it.text("id") }.distinct().size == custom.size) }
    @Synchronized fun list(): List<JSONObject> = (builtin + custom).map { it.copy() }
    fun get(id: String): JSONObject = list().find { it.text("id") == id } ?: fail("INVALID_INPUT", "This booru is not configured.")
    @Synchronized fun save(raw: JSONObject): JSONObject {
        val value = Policy.definition(raw, true); val next = custom.filter { it.text("id") != value.text("id") } + value
        checkInput(next.size <= 32, "Use up to 32 custom boorus."); atomicJson(File(folder, "boorus.json"), j("providers" to a(next)), 256 * 1024); custom = next; return value.copy()
    }
    @Synchronized fun remove(id: String) { checkInput(id.startsWith("custom-")); val next = custom.filter { it.text("id") != id }; atomicJson(File(folder, "boorus.json"), j("providers" to a(next))); custom = next }
}

class Credentials(private val folder: File, private val providers: Providers) {
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }; val alias = "FoliunaPreview.credentials.v1"
        if (store.containsAlias(alias)) return store.getKey(alias, null) as SecretKey
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        }.generateKey()
    }
    @Synchronized fun available(): Boolean = try { key(); true } catch (_: Exception) { false }
    private fun file(id: String) = File(folder, "${provider(id)}.credentials.enc")
    @Synchronized fun read(id: String): JSONObject? {
        if (!file(id).exists()) return null
        try {
            val envelope = readJson(file(id), 16384); checkInput(envelope.getInt("version") == 1)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)))
            val result = JSONObject(String(cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP))))
            checkInput(result.text("apiUrl") == providers.get(id).text("apiUrl")); return result
        } catch (_: Exception) { fail("CREDENTIALS_LOCKED", "Saved credentials cannot be unlocked. Replace or remove them in Settings.") }
    }
    @Synchronized fun status(id: String): JSONObject = try { val value = read(id); j("provider" to id, "saved" to (value != null), "username" to value?.text("username"), "locked" to false) }
        catch (_: Failure) { j("provider" to id, "saved" to true, "username" to null, "locked" to true) }
    @Synchronized fun save(input: JSONObject): JSONObject {
        val id = provider(input.opt("provider")); val source = providers.get(id); val username = input.text("username").trim(); val apiKey = input.text("apiKey")
        checkInput(source.text("auth") != "none" && username.isNotEmpty() && username.length <= 100 && !Regex("[:\\x00-\\x1f\\x7f]").containsMatchIn(username) && Regex("[!-~]{1,256}").matches(apiKey), "Enter a site username and API key, not an account password.")
        checkInput(source.text("auth") != "query" || Regex("[1-9][0-9]*").matches(username), "Enter the numeric user ID from the site's API settings.")
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
            val encrypted = cipher.doFinal(j("username" to username, "apiKey" to apiKey, "apiUrl" to source.text("apiUrl")).toString().toByteArray())
            atomicJson(file(id), j("version" to 1, "iv" to Base64.encodeToString(cipher.iv, Base64.NO_WRAP), "data" to Base64.encodeToString(encrypted, Base64.NO_WRAP)))
        } catch (_: Exception) { fail("ENCRYPTION", "Secure Android encryption is unavailable. Credentials were not saved.") }
        return status(id)
    }
    @Synchronized fun remove(id: String) { val f = file(id); if (f.exists() && !f.delete()) fail("STORAGE", "Could not remove the encrypted entry.") }
}

fun preference(input: JSONObject): JSONObject {
    val tags = input.optJSONArray("favoriteTags") ?: fail("INVALID_INPUT", "Invalid favorite tags.")
    checkInput(input.text("gridMode") in listOf("crop", "natural") && input.text("browsing") in listOf("pages", "infinite") && tags.length() <= 500)
    checkInput(tags.values().all { validTag(it) })
    return j("gridMode" to input.text("gridMode"), "browsing" to input.text("browsing"), "favoriteTags" to a(tags.values().distinct()))
}
fun collectionName(value: Any?): String {
    checkInput(value is String); val name = Normalizer.normalize((value as String).trim(), Normalizer.Form.NFC)
    checkInput(name.isNotEmpty() && name.length <= 100 && name.none { it.code < 32 || it.code == 127 }, "Use a collection name of 1–100 characters."); return name
}
