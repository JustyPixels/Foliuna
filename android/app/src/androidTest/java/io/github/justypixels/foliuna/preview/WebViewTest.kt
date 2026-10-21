package io.github.justypixels.foliuna.preview

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONObject
import java.io.File
import java.io.ByteArrayInputStream
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import android.webkit.WebView

@RunWith(AndroidJUnit4::class)
class WebViewTest {
    private val emulated = android.os.Build.HARDWARE in listOf("goldfish", "ranchu")
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private lateinit var web: WebView
    private fun js(expression: String): String {
        val latch = CountDownLatch(1); var result = ""
        instrumentation.runOnMainSync { web.evaluateJavascript(expression) { result = it; latch.countDown() } }
        check(latch.await(30, TimeUnit.SECONDS)) { "WebView did not answer: $expression" }
        return result
    }
    private fun waitFor(expression: String) {
        val until = System.currentTimeMillis() + 30000
        while (System.currentTimeMillis() < until) { if (js(expression) == "true") return; Thread.sleep(100) }
        throw AssertionError("Timed out: $expression; page=" + js("document.body.innerText.slice(0,2000)"))
    }
    private fun promise(expression: String): JSONObject {
        js("window.__answer=null;Promise.resolve($expression).then(v=>window.__answer=JSON.stringify(v)).catch(e=>window.__answer=JSON.stringify({failure:String(e)}))")
        waitFor("window.__answer!==null")
        return JSONObject(org.json.JSONTokener(js("window.__answer")).nextValue().toString())
    }
    private fun click(label: String) { assertEquals("true", js("(function(){var b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===$label||b.getAttribute('aria-label')===$label||(b.matches('.nav-item')&&b.textContent.trim().endsWith($label)));if(!b||b.disabled)return false;b.click();return true})()")) }
    private fun screenshot(name: String) {
        val file = File(context.cacheDir, "$name.png")
        assertTrue(UiDevice.getInstance(instrumentation).takeScreenshot(file))
        androidx.test.platform.io.PlatformTestStorageRegistry.getInstance().openOutputFile("$name.png").use { output -> file.inputStream().use { it.copyTo(output) } }
        file.delete()
    }
    private fun run(action: (ActivityScenario<MainActivity>) -> Unit) {
        val root = File(context.cacheDir, "web-test-${UUID.randomUUID()}").apply { mkdirs() }
        val fixture = JSONObject(instrumentation.context.assets.open("generated/providers.json").bufferedReader().use { it.readText() })
        val raw = fixture.getJSONArray("compatibility").getJSONObject(0).getJSONObject("raw")
        val bytes = android.util.Base64.decode(fixture.text("previewPng"), android.util.Base64.NO_WRAP)
        val clips = mapOf("webm" to instrumentation.context.assets.open("generated/clip.webm").use { it.readBytes() }, "gif" to instrumentation.context.assets.open("generated/clip.gif").use { it.readBytes() })
        val state = Services(context, root, Transport { url, _ ->
            val ext = url.encodedPath.substringAfterLast('.')
            if (ext in listOf("png", "webm", "gif")) HttpResult(200, mapOf("content-type" to mediaTypes[ext]!!), ByteArrayInputStream(clips[ext] ?: bytes)) {}
            else {
                val detail = Regex("/posts/[0-9]+\\.json").matches(url.encodedPath)
                val id = if (detail) url.encodedPath.substringAfterLast('/').substringBefore('.').toInt() else 42
                val post = raw.copy().put("id", id)
                if (id in listOf(43, 44)) {
                    val format = if (id == 43) "webm" else "gif"
                    post.getJSONObject("file").put("url", "https://static1.e621.net/clip.$format").put("ext", format).put("size", clips[format]!!.size).put("width", if (id == 43) 160 else 32).put("height", if (id == 43) 90 else 32)
                }
                HttpResult(200, mapOf("content-type" to "application/json"), ByteArrayInputStream(j((if (detail) "post" else "posts") to if (detail) post else a(listOf(post))).toString().toByteArray())) {}
            }
        }, 0)
        MainActivity.testServices = state; MainActivity.testExportDestination = null
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { web = it.bridge.webView }
                waitFor("!!window.foliuna && document.querySelectorAll('.nav-item').length===3 && !document.body.innerText.includes('Opening library')")
                action(scenario)
            }
        } finally { if (emulated) UiDevice.getInstance(instrumentation).unfreezeRotation(); state.archive.close(); MainActivity.testServices = null; MainActivity.testExportDestination = null; root.deleteRecursively() }
    }
    @Test fun bridgeIsolationAndRealUiJourney() = run {
        assertEquals("android", promise("window.foliuna.platform()").getJSONObject("value").text("name"))
        assertFalse(js("Object.keys(window.foliuna).join(',')").contains("fetch"))
        assertFalse(js("JSON.stringify(window.Capacitor.Plugins.CapacitorHttp)").contains("get"))
        assertEquals("false", js("!!window.Capacitor.Plugins.WebView.setServerBasePath"))
        assertTrue(promise("fetch('https://example.com/').then(()=>({blocked:false})).catch(()=>({blocked:true}))").getBoolean("blocked"))
        assertTrue(promise("fetch('/_capacitor_file_/data/data/secret').then(r=>({blocked:r.status===403}))").getBoolean("blocked"))
        js("document.querySelector('.search-panel form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
        waitFor("document.querySelectorAll('.post-card').length===1")
        js("document.querySelector('.post-card').scrollIntoView()")
        waitFor("Array.from(document.querySelectorAll('.post-card img')).every(i=>i.complete&&i.naturalWidth>0)")
        click("'View post 42'")
        waitFor("(document.querySelector('dialog[open]')||{innerText:''}).innerText.includes('Download original')")
        click("'Fullscreen'"); waitFor("!!document.querySelector('.mobile-viewer[open]')")
        UiDevice.getInstance(instrumentation).pressBack()
        waitFor("!document.querySelector('.mobile-viewer') && !!document.querySelector('.details-dialog[open]')")
        click("'Download original'")
        waitFor("document.body.innerText.includes('Archived')||document.body.innerText.includes('Saved')||document.body.innerText.includes('already')")
        click("'Close post details'"); click("'Gallery'")
        waitFor("document.querySelector('.intro h1').innerText.startsWith('Gallery') && document.querySelectorAll('.post-card').length===1 && !document.body.innerText.includes('Searching the selected source')")
        assertFalse(js("document.body.innerText").contains("Import sidecars"))
        click("'Settings'"); waitFor("(document.querySelector('dialog[open]')||{innerText:''}).innerText.includes('Export library')")
        assertFalse(js("document.querySelector('dialog[open]').innerText").contains("Choose archive folder"))
        assertTrue(js("document.querySelector('dialog[open]').innerText").contains("Android Keystore"))
        click("'Export library…'")
        val device = UiDevice.getInstance(instrumentation)
        assertTrue(device.wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.pkg("com.google.android.documentsui")), 10000) || device.wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.pkg("com.android.documentsui")), 10000))
        // Older DocumentsUI navigates through folders before returning cancellation.
        repeat(6) { if (device.currentPackageName != context.packageName) { device.pressBack(); device.wait(androidx.test.uiautomator.Until.hasObject(androidx.test.uiautomator.By.pkg(context.packageName)), 1000) } }
        waitFor("document.body.innerText.includes('Export cancelled')")
        UiDevice.getInstance(instrumentation).pressBack()
        waitFor("!document.querySelector('dialog[open]')")
        UiDevice.getInstance(instrumentation).pressBack()
        waitFor("document.querySelector('.intro h1').innerText.startsWith('Discover')")
    }
    @Test fun responsiveLayoutRotationAndKeyboard() = run { scenario ->
        assertEquals("false", js("document.documentElement.scrollWidth>window.innerWidth"))
        screenshot("android-layout")
        js("document.querySelector('#tags').focus()")
        waitFor("document.activeElement.id==='tags'")
        val point = JSONObject(org.json.JSONTokener(js("JSON.stringify((function(){var r=document.querySelector('#tags').getBoundingClientRect();return {x:(r.left+r.width/2)*devicePixelRatio,y:(r.top+r.height/2)*devicePixelRatio}})())")).nextValue().toString())
        val offset = IntArray(2); instrumentation.runOnMainSync { web.getLocationOnScreen(offset) }
        UiDevice.getInstance(instrumentation).click(point.getDouble("x").toInt() + offset[0], point.getDouble("y").toInt() + offset[1])
        UiDevice.getInstance(instrumentation).pressKeyCode(android.view.KeyEvent.KEYCODE_F)
        waitFor("document.querySelector('#tags').value.toLowerCase().includes('f')")
        js("document.activeElement.blur()")
        instrumentation.runOnMainSync { (context.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(web.windowToken, 0); web.clearFocus() }
        instrumentation.waitForIdleSync()
        if (emulated) UiDevice.getInstance(instrumentation).setOrientationLeft() else scenario.onActivity { it.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        waitFor("window.innerWidth>window.innerHeight")
        assertEquals("false", js("document.documentElement.scrollWidth>window.innerWidth"))
        if (emulated) UiDevice.getInstance(instrumentation).setOrientationNatural() else scenario.onActivity { it.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
        waitFor("window.innerHeight>window.innerWidth")
        assertEquals("false", js("document.documentElement.scrollWidth>window.innerWidth"))
    }
    @Test fun videoGifDecodingAndOfflinePlayback() = run {
        val video = promise("window.foliuna.getPost({provider:'e621',id:43})").getJSONObject("value")
        assertEquals("webm", video.getJSONObject("file").text("extension"))
        js("var v=document.createElement('video');v.id='test-video';v.muted=true;v.src=" + JSONObject.quote(video.text("originalUrl")) + ";document.body.appendChild(v);v.play().catch(function(){})")
        waitFor("document.querySelector('#test-video').videoWidth===160 && document.querySelector('#test-video').currentTime>0")
        val gif = promise("window.foliuna.getPost({provider:'e621',id:44})").getJSONObject("value")
        js("var i=new Image();i.id='test-gif';i.src=" + JSONObject.quote(gif.text("originalUrl")) + ";document.body.appendChild(i)")
        waitFor("document.querySelector('#test-gif').naturalWidth===32")
        val saved = promise("window.foliuna.downloadPost({provider:'e621',id:43})").getJSONObject("value")
        val local = promise("window.foliuna.galleryPost({provider:'e621',id:43,sha256:" + JSONObject.quote(saved.text("sha256")) + "})").getJSONObject("value")
        assertTrue(local.text("originalUrl").startsWith("https://localhost/foliuna/gallery/"))
        js("document.querySelector('#test-video').src=" + JSONObject.quote(local.text("originalUrl")) + ";document.querySelector('#test-video').play().catch(function(){})")
        waitFor("document.querySelector('#test-video').videoWidth===160 && document.querySelector('#test-video').currentTime>0")
    }
    @Test fun safDestinationProducesPortableFiles() {
        org.junit.Assume.assumeTrue("Use only owned emulators for automatic destination selection", emulated)
        run {
            val saved = promise("window.foliuna.downloadPost({provider:'e621',id:42})").getJSONObject("value")
            val created = promise("window.foliuna.collectionCreate({name:'Forest'})").getJSONArray("value").getJSONObject(0)
            assertTrue(promise("window.foliuna.collectionMembership({id:" + created.getLong("id") + ",sha256:" + JSONObject.quote(saved.text("sha256")) + ",present:true})").getBoolean("ok"))
            click("'Settings'"); waitFor("(document.querySelector('dialog[open]')||{innerText:''}).innerText.includes('Export library')")
            click("'Export library…'")
            val device = UiDevice.getInstance(instrumentation)
            fun text(pattern: String): androidx.test.uiautomator.UiObject2 = device.wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.text(java.util.regex.Pattern.compile(pattern))), 10000) ?: throw AssertionError("Destination picker missing: $pattern")
            val folderName = "Foliuna-export-test-" + System.nanoTime()
            try {
                device.wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.desc("Show roots")), 10000)?.click()
                text("(?i)Downloads?").click()
                val newFolder = device.findObject(androidx.test.uiautomator.By.desc(java.util.regex.Pattern.compile("(?i)(Create )?new folder")))
                if (newFolder != null) newFolder.click() else {
                    (device.wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.desc("More options")), 10000) ?: throw AssertionError("No folder menu")).click()
                    text("New folder").click()
                }
                val name = device.wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.clazz("android.widget.EditText")), 10000) ?: throw AssertionError("No folder name field")
                name.text = folderName
                text("(?i)OK|CREATE").click()
                text("(?i)USE THIS FOLDER|SELECT").click()
                device.wait(androidx.test.uiautomator.Until.findObject(androidx.test.uiautomator.By.text(java.util.regex.Pattern.compile("(?i)ALLOW"))), 3000)?.click()
                waitFor("document.body.innerText.includes('Export complete')")
                val uri = MainActivity.testExportDestination ?: throw AssertionError("No native destination result")
                val parent = androidx.documentfile.provider.DocumentFile.fromTreeUri(context, uri)!!
                val folder = parent.listFiles().single { it.isDirectory }
                assertNull(folder.findFile("EXPORT-INCOMPLETE.txt"))
                val media = folder.findFile("media")!!
                assertTrue(media.listFiles().any { it.name == saved.text("sha256") + ".png" })
                assertNotNull(folder.findFile(".foliuna")!!.findFile("collections.json"))
                androidx.test.platform.io.PlatformTestStorageRegistry.getInstance().openOutputFile("android-saf-export.zip").use { output ->
                    java.util.zip.ZipOutputStream(output).use { zip ->
                        fun copy(directory: androidx.documentfile.provider.DocumentFile, prefix: String) {
                            directory.listFiles().forEach { file ->
                                val path = prefix + file.name!!
                                if (file.isDirectory) copy(file, "$path/") else { zip.putNextEntry(java.util.zip.ZipEntry(path)); context.contentResolver.openInputStream(file.uri)!!.use { it.copyTo(zip) }; zip.closeEntry() }
                            }
                        }
                        copy(folder, "")
                    }
                }
                assertTrue(parent.delete())
            } catch (error: Throwable) { screenshot("saf-picker-failure"); throw error }
        }
    }
}
