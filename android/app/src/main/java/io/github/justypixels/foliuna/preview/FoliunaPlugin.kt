package io.github.justypixels.foliuna.preview

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.ActivityCallback
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.UUID
import org.json.JSONObject
import java.time.Instant

@CapacitorPlugin(name = "CapacitorHttp") class DisabledHttp : Plugin()
@CapacitorPlugin(name = "CapacitorCookies") class DisabledCookies : Plugin()
@CapacitorPlugin(name = "WebView") class DisabledWebView : Plugin()

@CapacitorPlugin(name = "Foliuna")
class FoliunaPlugin : Plugin() {
    private val executor = ThreadPoolExecutor(4, 4, 30, TimeUnit.SECONDS, ArrayBlockingQueue(64))
    private val services get() = (activity as MainActivity).services
    private fun trusted(): Boolean = (activity as MainActivity).trustedPage
    private fun resolve(call: PluginCall, value: Any?) { call.resolve(JSObject(j("ok" to true, "value" to value).toString())) }
    private fun reject(call: PluginCall, error: Exception) {
        val failure = error as? Failure ?: Failure("INTERNAL", "Foliuna could not complete the request. Existing files were preserved.")
        call.resolve(JSObject(j("ok" to false, "error" to j("code" to failure.code, "message" to failure.message)).toString()))
    }
    private fun run(call: PluginCall, action: () -> Any?) {
        if (!trusted()) { reject(call, Failure("FORBIDDEN", "Untrusted app frame.")); return }
        try { executor.execute { try { resolve(call, action()) } catch (error: Exception) { reject(call, error) } } } catch (_: Exception) { reject(call, Failure("BUSY", "Too many requests are pending.")) }
    }
    private fun input(call: PluginCall) = obj(call.data.opt("input"))
    private fun unsupported(): Nothing = fail("UNSUPPORTED", "This desktop operation is unavailable on Android.")
    @PluginMethod fun platform(call: PluginCall) = run(call) { j("name" to "android", "chooseLibrary" to false, "importSidecars" to false, "exportLibrary" to true, "floatingViewer" to false, "flash" to false) }
    @PluginMethod fun search(call: PluginCall) = run(call) { services.search(input(call)) }
    @PluginMethod fun getPost(call: PluginCall) = run(call) { services.post(input(call)) }
    @PluginMethod fun libraryStatus(call: PluginCall) = run(call) { services.archive.status() }
    @PluginMethod fun getSettings(call: PluginCall) = run(call) { services.settings() }
    @PluginMethod fun saveCredentials(call: PluginCall) = run(call) { services.saveCredentials(input(call)) }
    @PluginMethod fun removeCredentials(call: PluginCall) = run(call) { services.removeCredentials(call.data.opt("input")); null }
    @PluginMethod fun testConnection(call: PluginCall) = run(call) { services.test(call.data.opt("input")); null }
    @PluginMethod fun saveProvider(call: PluginCall) = run(call) { services.saveProvider(input(call)) }
    @PluginMethod fun removeProvider(call: PluginCall) = run(call) { services.removeProvider(call.data.opt("input")); null }
    @PluginMethod fun chooseLibrary(call: PluginCall) = run(call) { unsupported() }
    @PluginMethod fun downloadPost(call: PluginCall) = run(call) { if (!services.foreground) fail("CANCELLED", "Downloads require Foliuna in the foreground."); services.archive.download(input(call)) }
    @PluginMethod fun cancelDownload(call: PluginCall) { if (!trusted()) { reject(call, Failure("FORBIDDEN", "Untrusted app frame.")); return }; services.archive.cancelled.set(true); resolve(call, null) }
    @PluginMethod fun getPreferences(call: PluginCall) = run(call) { services.preferences() }
    @PluginMethod fun savePreferences(call: PluginCall) = run(call) { services.savePreferences(input(call)) }
    @PluginMethod fun suggestTags(call: PluginCall) = run(call) { services.suggest(call.data.opt("input")) }
    @PluginMethod fun getAccount(call: PluginCall) = run(call) { services.account() }
    @PluginMethod fun openViewer(call: PluginCall) = run(call) { unsupported() }
    @PluginMethod fun gallerySearch(call: PluginCall) = run(call) { services.archive.search(input(call)) }
    @PluginMethod fun galleryPost(call: PluginCall) = run(call) { services.archive.getPost(input(call)) }
    @PluginMethod fun galleryTags(call: PluginCall) = run(call) { val prefix = call.data.opt("input"); checkInput(prefix is String); services.archive.tags(prefix as String) }
    @PluginMethod fun importSidecars(call: PluginCall) = run(call) { unsupported() }
    @PluginMethod fun reconcileLibrary(call: PluginCall) = run(call) { services.archive.reconcile() }
    @PluginMethod fun cacheThumbnail(call: PluginCall) = run(call) { val value = input(call); services.archive.cacheThumbnail(value); null }
    @PluginMethod fun collectionList(call: PluginCall) = run(call) { services.archive.collections((call.data.opt("input") as? JSONObject)?.let { sha(it.opt("sha256")) }) }
    @PluginMethod fun collectionCreate(call: PluginCall) = run(call) { services.archive.changeCollection("create", input(call)) }
    @PluginMethod fun collectionRename(call: PluginCall) = run(call) { services.archive.changeCollection("rename", input(call)) }
    @PluginMethod fun collectionDelete(call: PluginCall) = run(call) { services.archive.changeCollection("delete", j("id" to call.data.opt("input"))) }
    @PluginMethod fun collectionMembership(call: PluginCall) = run(call) { services.archive.changeCollection("membership", input(call)) }
    @PluginMethod fun openPost(call: PluginCall) {
        run(call) {
            val url = services.sourcePost(input(call))
            activity.runOnUiThread { try { activity.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)) } catch (_: Exception) { /* No browser installed. */ } }
            null
        }
    }
    @PluginMethod fun exportLibrary(call: PluginCall) {
        if (!trusted()) { reject(call, Failure("FORBIDDEN", "Untrusted app frame.")); return }
        if (services.archive.busy) { reject(call, Failure("BUSY", "Wait for the archive task.")); return }
        startActivityForResult(call, Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION), "exportDestination")
    }
    @ActivityCallback private fun exportDestination(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK || result.data?.data == null) { resolve(call, j("exported" to 0, "cancelled" to true)); return }
        val destination = result.data!!.data!!
        run(call) {
            val parent = DocumentFile.fromTreeUri(context, destination) ?: fail("EXPORT", "The selected folder is unavailable.")
            val folder = parent.createDirectory("Foliuna-${Instant.now().toString().replace(':', '-')}-${UUID.randomUUID().toString().take(8)}") ?: fail("EXPORT", "Could not create an export folder.")
            // An interrupted export is visibly incomplete; the private archive is never modified.
            val marker = folder.createFile("text/plain", "EXPORT-INCOMPLETE.txt") ?: fail("EXPORT", "Could not prepare export.")
            context.contentResolver.openOutputStream(marker.uri, "w")!!.use { it.write("Export interrupted: retry into a new folder before using these files.".toByteArray()) }
            val count = services.archive.exportFiles { path, source ->
                var directory = folder
                val parts = path.split('/')
                parts.dropLast(1).forEach { part -> directory = directory.findFile(part) ?: directory.createDirectory(part) ?: fail("EXPORT", "Could not create export directory.") }
                checkInput(directory.findFile(parts.last()) == null, "Export would replace a file.")
                val file = directory.createFile("application/octet-stream", parts.last()) ?: fail("EXPORT", "Could not create exported file.")
                context.contentResolver.openOutputStream(file.uri, "w")?.use { output ->
                    source.inputStream().use { input ->
                        val buffer = ByteArray(65536)
                        while (true) { if (services.archive.cancelled.get()) fail("CANCELLED", "Export stopped. The private archive is unchanged."); val n = input.read(buffer); if (n < 0) break; output.write(buffer, 0, n) }
                    }
                } ?: fail("EXPORT", "Could not write exported file.")
                if (file.length() != source.length()) fail("EXPORT", "Export was incomplete. Retry into a new folder.")
            }
            if (!marker.delete()) fail("EXPORT", "Could not complete export. Retry into a new folder.")
            j("exported" to count, "cancelled" to false)
        }
    }
}
