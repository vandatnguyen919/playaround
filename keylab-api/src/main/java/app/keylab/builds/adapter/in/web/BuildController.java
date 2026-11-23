package app.keylab.builds.adapter.in.web;

import java.net.URI;
import java.util.UUID;

import app.keylab.builds.adapter.in.web.BuildJson.BuildView;
import app.keylab.builds.application.EditBuild;
import app.keylab.builds.application.SaveBuild;
import app.keylab.builds.domain.BuildNotFound;
import app.keylab.builds.query.BuildRow;
import app.keylab.builds.query.MyBuilds;
import app.keylab.shared.UserId;
import app.keylab.shared.concurrency.ETags;
import app.keylab.shared.concurrency.IfMatch;
import app.keylab.shared.idempotency.IdempotencyKeys;
import app.keylab.shared.idempotency.IdempotencyKeys.Stored;
import app.keylab.shared.paging.PageQuery;
import app.keylab.shared.paging.PageResult;
import app.keylab.shared.patch.JsonMergePatch;
import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.ProblemTypes;
import app.keylab.shared.security.Roles;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * US-08: BLD-01 lists my builds, BLD-02 saves one (Idempotency-Key, starts
 * private), BLD-04 renames it or changes its parts or visibility (JSON Merge
 * Patch with If-Match). Members only; someone else's build is 404.
 */
@RestController
@PreAuthorize("hasRole('" + Roles.USER + "')")
class BuildController {

    static final String MERGE_PATCH = "application/merge-patch+json";
    private static final CacheControl PRIVATE = CacheControl.noStore().cachePrivate();

    private final SaveBuild saveBuild;
    private final EditBuild editBuild;
    private final MyBuilds myBuilds;
    private final IdempotencyKeys idempotencyKeys;
    private final JsonMapper json;

    BuildController(SaveBuild saveBuild, EditBuild editBuild, MyBuilds myBuilds, IdempotencyKeys idempotencyKeys,
            JsonMapper json) {
        this.saveBuild = saveBuild;
        this.editBuild = editBuild;
        this.myBuilds = myBuilds;
        this.idempotencyKeys = idempotencyKeys;
        this.json = json;
    }

    /** BLD-01: public and private, newest change first; {@code visibility} narrows it. */
    @GetMapping("/v1/me/builds")
    ResponseEntity<PageResult<BuildView>> list(@RequestParam(required = false) String visibility,
            @RequestParam(required = false) String sort, PageQuery page, @AuthenticationPrincipal Jwt jwt) {
        if (visibility != null && !visibility.equals("public") && !visibility.equals("private")) {
            throw ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_parameter",
                    "visibility must be public or private");
        }
        MyBuilds.Sort order = sort == null ? MyBuilds.Sort.UPDATED
                : MyBuilds.Sort.from(sort).orElseThrow(() -> ApiProblem.of(ProblemTypes.BAD_REQUEST,
                        "invalid_parameter", "sort must be -updatedAt or -createdAt"));
        PageResult<BuildRow> rows;
        try {
            rows = myBuilds.list(owner(jwt), visibility, order, page);
        }
        catch (MyBuilds.BadPageToken ex) {
            throw ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_page_token",
                    "page_token is not a token from a previous page");
        }
        return ResponseEntity.ok().cacheControl(PRIVATE).body(rows.map(BuildJson::view));
    }

    /** BLD-02: a replay of the same Idempotency-Key within 24 h answers as the first request did. */
    @PostMapping(path = "/v1/builds", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<String> create(@RequestBody JsonNode body,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @AuthenticationPrincipal Jwt jwt) {
        UUID owner = owner(jwt);
        Stored result = idempotencyKeys.execute("builds:" + owner, idempotencyKey,
                IdempotencyKeys.hash(json.writeValueAsString(body)), () -> {
                    UUID created = saveBuild.save(owner, BuildJson.read(body));
                    return new Stored(201, "/v1/builds/" + created,
                            json.writeValueAsString(BuildJson.view(row(owner, created))));
                });
        ResponseEntity.BodyBuilder response = ResponseEntity.status(result.status())
            .cacheControl(PRIVATE)
            .contentType(MediaType.APPLICATION_JSON)
            .location(URI.create(result.location()));
        // The ETag of the build as it is now, so the builder can rename it right away, replay or not.
        UUID id = UUID.fromString(result.location().substring(result.location().lastIndexOf('/') + 1));
        myBuilds.get(owner, id).ifPresent((row) -> response.eTag(ETags.of(row.version())));
        return response.body(result.body());
    }

    /** BLD-04: rename, change parts or visibility. If-Match is required; a stale tag is 412. */
    @PatchMapping(path = "/v1/builds/{id}", consumes = MERGE_PATCH)
    ResponseEntity<BuildView> update(@PathVariable String id, @RequestBody JsonNode patch,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @AuthenticationPrincipal Jwt jwt) {
        UUID owner = owner(jwt);
        UUID buildId = parse(id);
        if (patch == null || !patch.isObject()) {
            throw ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_body", "Send a JSON Merge Patch object");
        }
        // The patch is applied to the build as stored and the result read as a whole, so a patch can
        // never leave a build that a save would refuse.
        editBuild.edit(owner, buildId, (version) -> IfMatch.check(ifMatch, ETags.of(version)),
                (current) -> BuildJson.read(JsonMergePatch.apply(json.valueToTree(BuildJson.input(current)), patch)));
        BuildRow row = row(owner, buildId);
        return ResponseEntity.ok().cacheControl(PRIVATE).eTag(ETags.of(row.version())).body(BuildJson.view(row));
    }

    private BuildRow row(UUID owner, UUID id) {
        return myBuilds.get(owner, id).orElseThrow(BuildNotFound::new);
    }

    private static UUID owner(Jwt jwt) {
        return UserId.of(jwt).value();
    }

    /** Anything that is not a UUID names no build: 404, like an id that does not exist. */
    private static UUID parse(String id) {
        try {
            return UUID.fromString(id);
        }
        catch (IllegalArgumentException ex) {
            throw new BuildNotFound();
        }
    }
}
