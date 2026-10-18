package io.github.justypixels.foliuna.preview

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class Services(context: Context, home: File = context.filesDir, transport: Transport = PublicTransport(), interval: Long = 1100) {
    @Volatile var foreground = true; private set
    val profile = File(home.canonicalFile, "profile").apply { mkdirs() }
    val providers = Providers(profile, JSONArray(context.assets.open("foliuna/providers.json").bufferedReader().use { it.readText() }))
    val credentials = Credentials(profile, providers)
    val api = ApiClient(providers, credentials, transport, interval)
    private val adapters = HashMap<String, BooruAdapter>()
    private val transfer = MediaTransfer(transport)
    val archive = Archive(File(home.canonicalFile, "archive"), { site, id -> adapter(site).snapshot(id, true) }, transfer)
    val media = Media(File(context.cacheDir.canonicalFile, "viewed-media"), transfer, archive)
    @Synchronized fun adapter(id: String): BooruAdapter = adapters.getOrPut(id) { CompatibleBooru(providers.get(id), api) }
    @Synchronized private fun changed() { api.clear(); adapters.clear() }
    fun settings() = j("encryptionAvailable" to credentials.available(), "credentials" to a(providers.list().map { credentials.status(it.text("id")) }), "library" to archive.status(), "providers" to a(providers.list()))
    fun preferences(): JSONObject = File(profile, "preferences.json").let { if (it.exists()) preference(readJson(it, 128 * 1024)) else j("gridMode" to "natural", "browsing" to "pages", "favoriteTags" to JSONArray()) }
    fun search(input: JSONObject) = query(input).let { media.result(adapter(it.text("provider")).search(it)) }
    fun post(input: JSONObject) = media.register(adapter(provider(input.opt("provider"))).snapshot(integer(input.opt("id"))).post)
    fun saveCredentials(input: JSONObject): JSONObject = credentials.save(input).also { changed() }
    fun removeCredentials(input: Any?) { credentials.remove(provider(input)); changed() }
    fun saveProvider(input: JSONObject): JSONObject {
        if (archive.busy) fail("BUSY", "Wait for the archive task.")
        return providers.save(input).also { changed() }
    }
    fun removeProvider(input: Any?) {
        if (archive.busy) fail("BUSY", "Wait for the archive task.")
        val id = provider(input); providers.remove(id); credentials.remove(id); changed()
    }
    fun savePreferences(input: JSONObject): JSONObject = preference(input).also { atomicJson(File(profile, "preferences.json"), it, 128 * 1024) }
    fun suggest(input: Any?): JSONArray {
        val site = if (input is String) "e621" else provider(obj(input).opt("provider"))
        val prefix = if (input is String) input else obj(input).text("prefix")
        return adapter(site).tags(prefix.lowercase())
    }
    fun test(input: Any?) {
        val site = provider(input)
        if (site == "e621" && credentials.read(site) == null) fail("CREDENTIALS_REQUIRED", "Save your e621 username and API key first.")
        adapter(site).search(j("provider" to site, "tags" to "", "page" to 1, "safeOnly" to true))
    }
    fun account(): JSONObject {
        if (credentials.read("e621") == null) fail("CREDENTIALS_REQUIRED", "Save your e621 username and API key first.")
        val raw = obj(api.json("e621", Policy.url("https://e621.net/users/me.json")))
        checkInput(raw.opt("name") is String && raw.opt("level_string") is String)
        fun count(key: String) = (raw.opt(key) as? Number)?.toLong()?.coerceAtLeast(0) ?: 0L
        return j("id" to integer(raw.opt("id")), "name" to raw.text("name").take(100), "level" to raw.text("level_string").take(80),
            "joined" to (raw.opt("created_at") as? String), "favorites" to count("favorite_count"), "uploads" to count("post_upload_count"),
            "favoriteTags" to a(raw.text("favorite_tags").split(Regex("\\s+")).filter { it.isNotEmpty() && it.length <= 200 }.take(200)))
    }
    fun sourcePost(input: JSONObject): String {
        val site = provider(input.opt("provider")); val id = integer(input.opt("id"))
        val source = if (input.has("archiveSha")) archive.getPost(j("provider" to site, "id" to id, "sha256" to sha(input.opt("archiveSha")))).getJSONObject("source") else providers.get(site)
        return Policy.postUrl(source, id)
    }
    fun pause() { foreground = false; archive.cancelled.set(true); media.pause() }
    fun resume() { foreground = true; media.resume() }
}
