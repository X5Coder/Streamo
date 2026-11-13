package com.streamo.link.android

import com.streamo.link.android.defense.Defense
import org.junit.Assert.assertEquals
import org.junit.Test

/** Deterministic checks for the ported NET shield (matches the Windows decide() contract). */
class DefenseTest {

    @Test
    fun adHostOnMainFrameIsBlocked() {
        assertEquals(Defense.Verdict.FAIL, Defense.decide("https://doubleclick.net/ads/x", isMainFrame = true, pageUrl = null))
    }

    @Test
    fun adHostAsSubresourceGetsStub() {
        assertEquals(Defense.Verdict.STUB, Defense.decide("https://www.googlesyndication.com/ad", isMainFrame = false, pageUrl = null))
    }

    @Test
    fun googleIsAlwaysAllowed() {
        assertEquals(Defense.Verdict.ALLOW, Defense.decide("https://www.google.com/search?q=x", isMainFrame = true, pageUrl = null))
        assertEquals(Defense.Verdict.ALLOW, Defense.decide("https://accounts.google.com/signin", isMainFrame = true, pageUrl = null))
    }

    @Test
    fun loginAndPaymentsAreAllowed() {
        assertEquals(Defense.Verdict.ALLOW, Defense.decide("https://accounts.google.com/signin/oauth", isMainFrame = true, pageUrl = null))
        assertEquals(Defense.Verdict.ALLOW, Defense.decide("https://stripe.com/checkout", isMainFrame = true, pageUrl = null))
        assertEquals(Defense.Verdict.ALLOW, Defense.decide("https://hcaptcha.com/captcha", isMainFrame = true, pageUrl = null))
    }

    @Test
    fun sameSiteIsAllowed() {
        assertEquals(Defense.Verdict.ALLOW, Defense.decide("https://example.com/video.m3u8", isMainFrame = false, pageUrl = "https://example.com/page"))
    }

    @Test
    fun vastGetsStub() {
        assertEquals(Defense.Verdict.STUB, Defense.decide("https://cdn.example-server.com/ads/vast_tracker.xml", isMainFrame = false, pageUrl = null))
    }

    @Test
    fun ordinaryVideoIsAllowed() {
        assertEquals(Defense.Verdict.ALLOW, Defense.decide("https://devstreaming-cdn.apple.com/videos/master.m3u8", isMainFrame = false, pageUrl = "https://somesite.com/watch"))
    }

    @Test
    fun affiliateRedirectCrossSiteIsBlockedOnMainFrame() {
        // cross-domain with affiliate param -> blocked on main frame
        assertEquals(
            Defense.Verdict.FAIL,
            Defense.decide("https://affiliate-site.example.com/?tag=partner123", isMainFrame = true, pageUrl = "https://somesite.com/watch")
        )
    }

    @Test
    fun plainAffiliateWithoutContextIsStubbedAsSubresource() {
        assertEquals(
            Defense.Verdict.STUB,
            Defense.decide("https://cdn-example.com/ads/adserver/banner?clickid=abc", isMainFrame = false, pageUrl = "https://somesite.com")
        )
    }
}
