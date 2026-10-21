package io.github.justypixels.foliuna.preview

import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.FutureTask
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class Media(private val folder: File, private val transfer: MediaTransfer, private val archive: Archive) {
    private val posts = LinkedHashMap<String, JSONObject>()
    private val active = Semaphore(2, true)
    private val waiting = AtomicInteger()
    private val flights = ConcurrentHashMap<String, FutureTask<File>>()
    private val cancelled = AtomicBoolean()
    private val cache = LinkedHashMap<String, File>(16, .75f, true)
    init { folder.mkdirs(); checkInput(folder.isDirectory && folder.canonicalFile == folder.absoluteFile, "Unsafe media cache folder."); folder.listFiles()?.forEach { it.delete() } }
    fun pause() { cancelled.set(true) }
    fun resume() { cancelled.set(false) }
    @Synchronized fun register(post: JSONObject): JSONObject {
        val key = post.text("provider") + "/" + post.getLong("id")
        posts[key] = post.copy(); while (posts.size > 20000) posts.remove(posts.keys.first())
        return post.copy().apply {
            listOf("previewUrl" to "preview", "sampleUrl" to "sample", "originalUrl" to "original").forEach { (field, variant) ->
                put(field, if (post.opt(field) is String) "https://localhost/foliuna/media/$key/$variant" else JSONObject.NULL)
            }
            getJSONObject("file").put("url", opt("originalUrl"))
        }
    }
    fun result(value: JSONObject): JSONObject = value.copy().apply { put("posts", a(value.getJSONArray("posts").values().map { register(obj(it)) })) }
    private fun cached(url: String, source: JSONObject, variant: String): File {
        val key = hash(url.toByteArray())
        synchronized(cache) {
            cache[key]?.let {
                if (it.isFile && System.currentTimeMillis() - it.lastModified() < 300000) return it
                cache.remove(key); it.delete()
            }
        }
        val task = FutureTask {
            if (waiting.incrementAndGet() > 48) { waiting.decrementAndGet(); fail("BUSY", "Too many media requests.") }
            try {
                active.acquire()
                try {
                    if (cancelled.get()) fail("CANCELLED", "Media paused.")
                    val target = File(folder, UUID.randomUUID().toString() + "." + url.substringBefore('?').substringAfterLast('.'))
                    try {
                        transfer.save(url, source, target, if (variant == "preview") 8L * 1024 * 1024 else MAX_ORIGINAL, cancelled)
                        synchronized(cache) {
                            cache[key] = target
                            while (cache.size > 128 || cache.values.sumOf { it.length() } > 128L * 1024 * 1024) {
                                val first = cache.entries.first(); cache.remove(first.key); if (first.value != target) first.value.delete()
                            }
                        }
                        target
                    } catch (error: Exception) { target.delete(); throw error }
                } finally { active.release() }
            } finally { waiting.decrementAndGet() }
        }
        val actual = flights.putIfAbsent(key, task) ?: task
        try { if (actual === task) task.run(); return actual.get() } finally { if (actual === task) flights.remove(key, task) }
    }
    fun response(path: String, method: String, range: String?): WebResourceResponse {
        checkInput(method in listOf("GET", "HEAD"))
        val parts = path.trim('/').split('/')
        val file: File
        if (parts.size == 5 && parts.take(2) == listOf("foliuna", "media")) {
            val id = integer(parts[3].toLongOrNull()); val site = provider(parts[2]); val variant = parts[4]
            checkInput(variant in listOf("preview", "sample", "original"))
            val post = synchronized(this) { posts["$site/$id"]?.copy() } ?: fail("NOT_FOUND", "Media registration expired.")
            val field = when (variant) { "preview" -> "previewUrl"; "sample" -> "sampleUrl"; else -> "originalUrl" }
            val url = post.opt(field) as? String ?: fail("NOT_FOUND", "Media is unavailable.")
            // Flash is deliberately deferred on Android.
            checkInput(!url.endsWith(".swf", true))
            file = cached(url, post.getJSONObject("source"), variant)
        } else if (parts.size == 4 && parts.take(2) == listOf("foliuna", "gallery")) {
            val hash = sha(parts[2]); checkInput(parts[3] in listOf("thumbnail", "original"))
            val thumbnail = File(archive.root, ".foliuna/thumbnails/$hash.png")
            file = if (parts[3] == "thumbnail" && thumbnail.isFile) { archive.asset(hash); checkInput(thumbnail.canonicalFile == thumbnail.absoluteFile && thumbnail.length() <= 2 * 1024 * 1024); thumbnail } else archive.original(hash)
        } else fail("NOT_FOUND", "Unknown media.")
        val size = file.length()
        var start = 0L; var end = size - 1; var status = 200
        if (range != null) {
            val match = Regex("bytes=([0-9]*)-([0-9]*)").matchEntire(range) ?: fail("RANGE", "Unsupported range.")
            val left = match.groupValues[1]; val right = match.groupValues[2]
            checkInput(left.isNotEmpty() || right.isNotEmpty())
            if (left.isEmpty()) start = (size - (right.toLongOrNull() ?: 0)).coerceAtLeast(0) else { start = left.toLongOrNull() ?: size; if (right.isNotEmpty()) end = (right.toLongOrNull() ?: -1).coerceAtMost(end) }
            if (start !in 0 until size || end < start) return WebResourceResponse("text/plain", "UTF-8", 416, "Range Not Satisfiable", mapOf("Content-Range" to "bytes */$size"), java.io.ByteArrayInputStream(ByteArray(0)))
            status = 206
        }
        val headers = mutableMapOf("Content-Length" to "${end - start + 1}", "Accept-Ranges" to "bytes", "Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff")
        if (status == 206) headers["Content-Range"] = "bytes $start-$end/$size"
        val stream = if (method == "HEAD") java.io.ByteArrayInputStream(ByteArray(0)) else FileInputStream(file).apply { channel.position(start) }
        val length = end - start + 1
        return WebResourceResponse(mediaTypes[file.extension.lowercase()] ?: "application/octet-stream", null, status, if (status == 206) "Partial Content" else "OK", headers, object : InputStream() {
            var remaining = length
            override fun read(): Int { if (remaining <= 0) return -1; val next = stream.read(); if (next >= 0) remaining--; return next }
            override fun read(bytes: ByteArray, offset: Int, count: Int): Int { if (remaining <= 0) return -1; return stream.read(bytes, offset, minOf(count.toLong(), remaining).toInt()).also { if (it > 0) remaining -= it } }
            override fun close() = stream.close()
        })
    }
}
