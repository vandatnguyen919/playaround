package app.keylab.builds.adapter.in.web;

import app.keylab.builds.adapter.in.web.BuildJson.BuildView;
import app.keylab.builds.domain.BuildNotFound;
import app.keylab.builds.query.MyBuilds;
import app.keylab.shared.UserId;
import app.keylab.shared.concurrency.ETags;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * BLD-03, a build's link: a public build for anyone, a private one only for
 * its owner, a deleted one for nobody (404, never 403, so private builds do
 * not leak). US-12 needs it for "deleted builds return 404 on their old link";
 * US-09 adds the shared page on top.
 *
 * <p>{@code no-cache} with an ETag: a cache may keep the answer but asks
 * again every time, so going private or a delete shows at once.
 */
@RestController
class SharedBuildController {

    private final MyBuilds builds;

    SharedBuildController(MyBuilds builds) {
        this.builds = builds;
    }

    @GetMapping("/v1/builds/{id}")
    ResponseEntity<BuildView> get(@PathVariable String id, @AuthenticationPrincipal Jwt jwt) {
        MyBuilds.Shared shared = builds.shared(jwt == null ? null : UserId.of(jwt).value(), BuildController.parse(id))
            .orElseThrow(BuildNotFound::new);
        CacheControl cache = shared.own() || "private".equals(shared.row().visibility())
                ? CacheControl.noCache().cachePrivate() : CacheControl.noCache().cachePublic();
        return ResponseEntity.ok()
            .cacheControl(cache)
            .eTag(ETags.of(shared.row().version()))
            .body(BuildJson.view(shared.row(), shared.own() ? BuildJson.ME : BuildJson.MEMBER));
    }
}
