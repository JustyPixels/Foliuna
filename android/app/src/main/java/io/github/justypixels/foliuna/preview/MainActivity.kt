package io.github.justypixels.foliuna.preview

import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.util.Base64
import com.getcapacitor.BridgeActivity
import com.getcapacitor.BridgeWebViewClient
import java.io.ByteArrayInputStream
import java.security.MessageDigest

class MainActivity : BridgeActivity() {
    @Volatile var trustedPage = false
        private set
    companion object {
        private var instance: Services? = null
        // Set only from native instrumentation, never through intents or the WebView.
        internal var testServices: Services? = null
    }
    val services: Services get() = testServices ?: instance ?: synchronized(MainActivity::class.java) { instance ?: Services(applicationContext).also { instance = it } }
    override fun onCreate(state: Bundle?) {
        registerPlugin(DisabledHttp::class.java); registerPlugin(DisabledCookies::class.java); registerPlugin(DisabledWebView::class.java); registerPlugin(FoliunaPlugin::class.java)
        super.onCreate(state)
    }
    @Suppress("DEPRECATION")
    override fun load() {
        super.load()
        val web = bridge.webView
        web.settings.apply {
            allowFileAccess = false; allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            javaScriptCanOpenWindowsAutomatically = false
            setGeolocationEnabled(false); mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        CookieManager.getInstance().apply { setAcceptCookie(false); setAcceptThirdPartyCookies(web, false); removeAllCookies(null) }
        web.setDownloadListener { _, _, _, _, _ -> }
        web.webChromeClient = object : android.webkit.WebChromeClient() {
            override fun onPermissionRequest(request: android.webkit.PermissionRequest) { request.deny() }
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: android.webkit.GeolocationPermissions.Callback) { callback.invoke(origin, false, false) }
        }
        bridge.setWebViewClient(object : BridgeWebViewClient(bridge) {
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                trustedPage = url in listOf("https://localhost/", "https://localhost/index.html")
                super.onPageStarted(view, url, favicon)
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                val uri = request.url
                if (uri.scheme != "https" || uri.host != "localhost" || uri.port !in listOf(-1, 443) || uri.userInfo != null || uri.query != null) return blocked()
                val path = uri.encodedPath.orEmpty()
                if (path.startsWith("/foliuna/")) return try { services.media.response(path, request.method, request.requestHeaders.entries.find { it.key.equals("range", true) }?.value) } catch (_: Exception) { blocked() }
                if (request.method != "GET" || !(path in listOf("/", "/index.html") || Regex("/assets/[A-Za-z0-9_.-]+\\.(js|css|svg|png|woff2)").matches(path))) return blocked()
                if (path in listOf("/", "/index.html") && !request.isForMainFrame) return blocked()
                val response = super.shouldInterceptRequest(view, request) ?: return blocked()
                if (path in listOf("/", "/index.html")) {
                    val html = response.data.use { String(it.readBytesBounded(2 * 1024 * 1024)) }
                    val scripts = Regex("<script[^>]*>([\\s\\S]*?)</script>").findAll(html).map { it.groupValues[1] }.filter { it.isNotBlank() }.toList()
                    val hashes = scripts.joinToString(" ") { "'sha256-" + Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(it.toByteArray()), Base64.NO_WRAP) + "'" }
                    val csp = "default-src 'none'; script-src 'self' $hashes; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
                    return WebResourceResponse("text/html", "UTF-8", 200, "OK", mapOf("Content-Security-Policy" to csp, "X-Content-Type-Options" to "nosniff", "Cache-Control" to "no-store"), ByteArrayInputStream(html.toByteArray()))
                }
                return response
            }
        })
    }
    override fun onPause() { try { services.pause() } catch (_: Exception) { /* The bridge reports preserved archive errors. */ }; super.onPause() }
    override fun onResume() { super.onResume(); try { services.resume() } catch (_: Exception) { /* Do not reset an unreadable archive. */ } }
}
fun blocked() = WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))
