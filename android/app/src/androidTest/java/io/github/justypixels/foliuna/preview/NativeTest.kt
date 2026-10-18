package io.github.justypixels.foliuna.preview

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.io.ByteArrayInputStream
import java.net.InetAddress
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(AndroidJUnit4::class)
class NativeTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val fixtures = JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("generated/providers.json").bufferedReader().use { it.readText() })
    private val cases get() = fixtures.getJSONArray("compatibility").values().map { obj(it) }
    private val png get() = android.util.Base64.decode(fixtures.text("previewPng"), android.util.Base64.NO_WRAP)
    private fun directory() = File(context.cacheDir, "native-test-${UUID.randomUUID()}").apply { mkdirs() }
    private fun response(value: Any, status: Int = 200, headers: Map<String, String> = emptyMap()): HttpResult = HttpResult(status, mapOf("content-type" to "application/json") + headers, ByteArrayInputStream(value.toString().toByteArray())) {}
    private fun denied(action: () -> Unit): Failure { try { action() } catch (error: Failure) { return error }; throw AssertionError("Expected a rejected request") }
    private fun services(root: File, transport: Transport) = Services(context, root, transport, 0)
    private fun fixtureTransport() = Transport { url, headers ->
        if (url.encodedPath.endsWith(".png")) { assertFalse(headers.containsKey("Authorization")); assertNull(url.queryParameter("api_key")); HttpResult(200, mapOf("content-type" to "image/png", "content-length" to png.size.toString()), ByteArrayInputStream(png)) {} }
        else {
            val item = cases.find { Policy.url(it.getJSONObject("source").text("apiUrl")).host == url.host } ?: cases.first()
            val source = item.getJSONObject("source"); val raw = item.getJSONObject("raw")
            val detail = url.encodedPath.endsWith("/42.json")
            response(when (source.text("engine")) { "e621" -> j((if (detail) "post" else "posts") to if (detail) raw else a(listOf(raw))); "danbooru" -> if (detail) raw else a(listOf(raw)); "gelbooru" -> j("post" to a(listOf(raw))); else -> a(listOf(raw)) })
        }
    }
    @Test fun providerNormalizationAndStableCustomIdentity() {
        val root = directory()
        try {
            val state = services(root, fixtureTransport())
            assertEquals(8, state.providers.list().size)
            cases.forEach { value ->
                val source = value.getJSONObject("source"); val raw = value.getJSONObject("raw"); val expected = value.getJSONObject("expected")
                if (source.text("id").startsWith("custom-")) assertEquals(source.text("id"), state.providers.save(source).text("id"))
                if (source.text("id") == "rule34") state.saveCredentials(j("provider" to "rule34", "username" to "123", "apiKey" to "FICTIONAL"))
                assertEquals(1, state.adapter(source.text("id")).search(j("provider" to source.text("id"), "tags" to "", "page" to 1)).getJSONArray("posts").length())
                val actual = normalized(raw, source).post
                listOf("provider", "id", "rating", "previewUrl", "sampleUrl", "originalUrl", "score", "favorites").forEach { assertEquals(source.text("id") + ":" + it, expected.opt(it).toString(), actual.opt(it).toString()) }
                categories.forEach { assertEquals(expected.getJSONObject("tags").getJSONArray(it).toString(), actual.getJSONObject("tags").getJSONArray(it).toString()) }
            }
            denied { normalized(cases.first().getJSONObject("raw").copy().put("rating", "g"), cases.first().getJSONObject("source")) }
            state.archive.close()
        } finally { root.deleteRecursively() }
    }
    @Test fun publicDestinationsAndExactEndpoints() {
        listOf("http://booru.org/", "https://localhost/", "https://127.0.0.1/", "https://2130706433/", "https://home.local/", "https://[::1]/", "https://user:secret@booru.org/", "https://booru.org:8443/").forEach { denied { Policy.url(it) } }
        listOf("127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.0.1", "100.64.0.1", "198.18.0.1", "::1", "fc00::1", "2001:db8::1", "2002::1", "::ffff:127.0.0.1").forEach { assertFalse(it, Policy.address(InetAddress.getByName(it))) }
        assertTrue(Policy.address(InetAddress.getByName("8.8.8.8")))
        val root = directory(); val calls = AtomicInteger()
        try {
            val state = services(root, Transport { _, _ -> calls.incrementAndGet(); response(JSONArray()) })
            listOf("https://e621.net/private.json", "https://other.booru.org/posts.json", "https://e621.net/posts.json?api_key=INJECTED", "https://e621.net/posts.json?redirect=https://booru.org/").forEach { denied { state.api.json("e621", Policy.url(it)) } }
            assertNull(Policy.media("https://unlisted.booru.org/x.png", state.providers.get("e621")))
            assertNull(Policy.media("https://static1.e621.net/x.svg", state.providers.get("e621")))
            assertNull(Policy.media("https://static1.e621.net/x.png?api_key=secret", state.providers.get("e621")))
            assertEquals(0, calls.get()); state.archive.close()
        } finally { root.deleteRecursively() }
    }
    @Test fun keystoreCredentialsAndCredentialSeparation() {
        val root = directory()
        try {
            val seen = mutableListOf<Pair<okhttp3.HttpUrl, Map<String, String>>>()
            val state = services(root, Transport { url, headers -> seen.add(url to headers); response(JSONArray()) })
            assertTrue(state.credentials.available())
            state.saveCredentials(j("provider" to "e621", "username" to "fictional", "apiKey" to "FICTIONAL_KEY"))
            state.saveCredentials(j("provider" to "rule34", "username" to "123", "apiKey" to "OTHER_FICTIONAL"))
            assertFalse(state.settings().toString().contains("FICTIONAL"))
            assertFalse(File(state.profile, "e621.credentials.enc").readText().contains("FICTIONAL"))
            val restarted = Credentials(state.profile, state.providers)
            assertEquals("FICTIONAL_KEY", restarted.read("e621")!!.text("apiKey"))
            state.api.json("e621", Policy.url("https://e621.net/posts.json"))
            state.api.json("rule34", Policy.url("https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1"))
            assertTrue(seen[0].second["Authorization"]!!.startsWith("Basic "))
            assertNull(seen[0].first.queryParameter("api_key"))
            assertEquals("OTHER_FICTIONAL", seen[1].first.queryParameter("api_key"))
            assertFalse(seen[1].second.containsKey("Authorization"))
            val encrypted = File(state.profile, "e621.credentials.enc"); val envelope = readJson(encrypted); envelope.put("data", "CORRUPTED"); atomicJson(encrypted, envelope)
            assertTrue(state.credentials.status("e621").getBoolean("locked")); assertTrue(encrypted.exists())
            assertEquals("CREDENTIALS_LOCKED", denied { restarted.read("e621") }.code)
            state.removeCredentials("e621"); assertNull(restarted.read("e621")); state.archive.close()
        } finally { root.deleteRecursively() }
    }
    @Test fun cachePacingCooldownAndResponseBounds() {
        val root = directory()
        try {
            val state = services(root, fixtureTransport())
            val times = mutableListOf<Long>()
            val api = ApiClient(state.providers, state.credentials, Transport { _, _ -> times.add(System.nanoTime()); response(j("posts" to JSONArray())) }, 1100)
            val url = Policy.url("https://e621.net/posts.json")
            api.json("e621", url); api.json("e621", url); api.json("e621", url.newBuilder().addQueryParameter("page", "2").build())
            assertEquals(2, times.size); assertTrue((times[1] - times[0]) / 1000000 >= 1090)
            val calls = AtomicInteger()
            val paused = ApiClient(state.providers, state.credentials, Transport { _, _ -> calls.incrementAndGet(); response(j(), 429, mapOf("retry-after" to "60")) }, 0)
            assertEquals("RATE_LIMIT", denied { paused.json("e621", url) }.code)
            assertEquals("RATE_LIMIT", denied { paused.json("e621", url) }.code); assertEquals(1, calls.get())
            val invalid = ApiClient(state.providers, state.credentials, Transport { _, _ -> HttpResult(200, mapOf("content-type" to "text/html"), ByteArrayInputStream("<html/>".toByteArray())) {} }, 0)
            assertEquals("INVALID_RESPONSE", denied { invalid.json("e621", url) }.code)
            denied { ByteArrayInputStream(ByteArray(9)).readBytesBounded(8) }
            state.archive.close()
        } finally { root.deleteRecursively() }
    }
    @Test fun archiveDedupHistoryCollectionsRestartAndExport() {
        val root = directory(); val exported = File(context.getExternalFilesDir(null), "verified-export").apply { deleteRecursively(); mkdirs() }
        try {
            val state = services(root, fixtureTransport())
            val request = j("provider" to "e621", "id" to 42)
            val first = state.archive.download(request); val second = state.archive.download(request)
            assertFalse(first.getBoolean("duplicate")); assertTrue(second.getBoolean("duplicate"))
            assertEquals(1, state.archive.status().getInt("assets"))
            assertEquals(2, state.archive.sidecar(first.text("sha256")).getJSONArray("sources").getJSONObject(0).getJSONArray("snapshots").length())
            assertTrue(state.archive.download(j("provider" to "danbooru", "id" to 42)).getBoolean("duplicate"))
            val custom = cases.last().getJSONObject("source"); state.providers.save(custom)
            assertTrue(state.archive.download(j("provider" to custom.text("id"), "id" to 42)).getBoolean("duplicate"))
            assertEquals(3, state.archive.sidecar(first.text("sha256")).getJSONArray("sources").length())
            val collection = state.archive.changeCollection("create", j("name" to "Forest")).getJSONObject(0)
            state.archive.changeCollection("membership", j("id" to collection.getLong("id"), "sha256" to first.text("sha256"), "present" to true))
            assertEquals(1, state.archive.search(j("tags" to "species:deer -wolf rating:s", "page" to 1, "collectionId" to collection.getLong("id"))).getJSONArray("posts").length())
            assertEquals(0, state.archive.search(j("tags" to "wolf", "page" to 1)).getJSONArray("posts").length())
            val hash = first.text("sha256"); val bytes = state.archive.original(hash).readBytes(); assertArrayEquals(png, bytes)
            assertEquals(1, state.archive.exportFiles { path, file -> File(exported, path).apply { parentFile!!.mkdirs(); file.copyTo(this, false) } })
            assertTrue(File(exported, ".foliuna/collections.json").isFile)
            assertFalse(exported.walkTopDown().any { it.name.contains("credentials") || it.extension == "sqlite" })
            androidx.test.platform.io.PlatformTestStorageRegistry.getInstance().openOutputFile("android-export.zip").use { output ->
                java.util.zip.ZipOutputStream(output).use { zip ->
                    exported.walkTopDown().filter { it.isFile }.forEach { file ->
                        zip.putNextEntry(java.util.zip.ZipEntry(file.relativeTo(exported).invariantSeparatorsPath)); file.inputStream().use { it.copyTo(zip) }; zip.closeEntry()
                    }
                }
            }
            state.archive.close()
            val offline = services(root, Transport { _, _ -> throw AssertionError("Offline gallery attempted networking") })
            assertEquals(1, offline.archive.search(j("tags" to "", "page" to 1)).getJSONArray("posts").length())
            assertEquals(1L, offline.archive.collections(hash).getJSONObject(0).getLong("assets"))
            assertTrue(offline.archive.collections(hash).getJSONObject(0).getBoolean("contains"))
            offline.archive.changeCollection("delete", j("id" to collection.getLong("id")))
            assertArrayEquals(bytes, offline.archive.original(hash).readBytes())
            offline.archive.close()
        } finally { root.deleteRecursively() }
    }
    @Test fun cancellationRecoveryAndMediaValidation() {
        val root = directory()
        try {
            val state = services(root, fixtureTransport()); val archive = state.archive
            val capture = UUID.randomUUID().toString(); val stage = File(archive.root, ".foliuna/staging/$capture.part").apply { writeBytes(png) }
            archive.db.exec("INSERT INTO download_journal(id,phase,payload_json) VALUES(?,'downloading',?)", capture, j("captureId" to capture, "stage" to "$capture.part").toString())
            archive.recover(); assertFalse(stage.exists()); assertTrue(archive.db.rows("SELECT * FROM download_journal").isEmpty())
            val target = File(root, "transfer.png")
            val transfer = MediaTransfer(fixtureTransport())
            assertEquals("CANCELLED", denied { transfer.save("https://static1.e621.net/fixture.png", state.providers.get("e621"), target, 1000, AtomicBoolean(true)) }.code)
            assertEquals("CHECKSUM", denied { transfer.save("https://static1.e621.net/fixture.png", state.providers.get("e621"), target, 1000, AtomicBoolean(false), png.size.toLong(), "0".repeat(32)) }.code)
            denied { transfer.save("https://static1.e621.net/fixture.png", state.providers.get("e621"), target, 10, AtomicBoolean(false)) }
            assertTrue(archive.db.rows("SELECT * FROM assets").isEmpty())
            val prepared = UUID.randomUUID().toString(); val part = File(archive.root, ".foliuna/staging/$prepared.part").apply { writeBytes(png) }
            val metadata = state.adapter("e621").snapshot(42).metadata
            val plan = j("captureId" to prepared, "provider" to "e621", "postId" to 42, "capturedAt" to java.time.Instant.now().toString(), "stage" to "$prepared.part", "sha256" to hash(png), "bytes" to png.size, "extension" to "png", "metadata" to metadata)
            archive.db.exec("INSERT INTO download_journal(id,phase,payload_json) VALUES(?,'prepared',?)", prepared, plan.toString()); archive.close()
            val restarted = services(root, Transport { _, _ -> throw AssertionError("Recovery attempted redownload") })
            assertEquals(1, restarted.archive.status().getInt("assets")); assertFalse(part.exists())
            restarted.archive.recover()
            assertEquals(1, restarted.archive.sidecar(hash(png)).getJSONArray("sources").getJSONObject(0).getJSONArray("snapshots").length())
            assertTrue(restarted.archive.db.rows("SELECT * FROM download_journal").isEmpty()); restarted.archive.close()
        } finally { root.deleteRecursively() }
    }
}
