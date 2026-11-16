package app.keylab.catalog.adapter.in.web.admin;

import java.math.BigDecimal;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import app.keylab.catalog.application.AddSwitch;
import app.keylab.catalog.application.DeleteSwitch;
import app.keylab.catalog.application.EditSwitch;
import app.keylab.catalog.application.EditSwitch.VersionCheck;
import app.keylab.catalog.application.PublishSwitch;
import app.keylab.catalog.domain.SwitchNotFound;
import app.keylab.catalog.query.AdminSwitchQueries;
import app.keylab.catalog.query.Recording;
import app.keylab.catalog.query.SwitchRow;
import app.keylab.catalog.query.SwitchRow.CurvePoint;
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

import com.fasterxml.jackson.annotation.JsonInclude;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * ADM-02 for one switch (US-37): create a draft, read, edit with JSON Merge
 * Patch and If-Match, delete a draft. ADM-03 (US-39): publish to, or pull
 * from, the public library. Editor and up. The list (US-36) joins this
 * controller with its own story.
 */
@RestController
@RequestMapping("/v1/admin/switches")
@PreAuthorize("hasRole('" + Roles.EDITOR + "')")
class AdminSwitchController {

    static final String MERGE_PATCH = "application/merge-patch+json";
    private static final CacheControl PRIVATE = CacheControl.noStore().cachePrivate();

    private final AddSwitch addSwitch;
    private final EditSwitch editSwitch;
    private final DeleteSwitch deleteSwitch;
    private final PublishSwitch publishSwitch;
    private final AdminSwitchQueries queries;
    private final IdempotencyKeys idempotencyKeys;
    private final JsonMapper json;
    private final Clock clock = Clock.systemUTC();

    AdminSwitchController(AddSwitch addSwitch, EditSwitch editSwitch, DeleteSwitch deleteSwitch,
            PublishSwitch publishSwitch, AdminSwitchQueries queries, IdempotencyKeys idempotencyKeys,
            JsonMapper json) {
        this.addSwitch = addSwitch;
        this.editSwitch = editSwitch;
        this.deleteSwitch = deleteSwitch;
        this.publishSwitch = publishSwitch;
        this.queries = queries;
        this.idempotencyKeys = idempotencyKeys;
        this.json = json;
    }

    /** ADM-02 list, drafts included, by name. US-36 adds its filters and sorts. */
    @GetMapping
    ResponseEntity<PageResult<AdminSwitch>> list(@RequestParam(required = false) String q, PageQuery page) {
        return ResponseEntity.ok().cacheControl(PRIVATE).body(queries.list(q, page).map(this::view));
    }

    @GetMapping("/{id}")
    ResponseEntity<AdminSwitch> get(@PathVariable String id) {
        return current(parse(id));
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<String> create(@RequestBody JsonNode body,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @AuthenticationPrincipal Jwt jwt) {
        UserId editor = UserId.of(jwt);
        Stored result = idempotencyKeys.execute("catalog-switches:" + editor, idempotencyKey,
                IdempotencyKeys.hash(json.writeValueAsString(body)), () -> {
                    UUID created = addSwitch.add(SwitchSpecsReader.read(body), SwitchSpecsReader.photo(body),
                            editor.toString());
                    return new Stored(201, "/v1/admin/switches/" + created,
                            json.writeValueAsString(view(queries.get(created))));
                });
        ResponseEntity.BodyBuilder response = ResponseEntity.status(result.status())
            .cacheControl(PRIVATE)
            .contentType(MediaType.APPLICATION_JSON)
            .location(URI.create(result.location()));
        // The ETag of the switch as it is now, so the editor can PATCH right away, replay or not.
        UUID id = UUID.fromString(result.location().substring(result.location().lastIndexOf('/') + 1));
        try {
            response.eTag(etag(queries.get(id)));
        }
        catch (SwitchNotFound gone) {
            // Deleted since the first request: the replay still answers as the first one did.
        }
        return response.body(result.body());
    }

    @PatchMapping(path = "/{id}", consumes = MERGE_PATCH)
    ResponseEntity<AdminSwitch> update(@PathVariable String id, @RequestBody JsonNode patch,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @AuthenticationPrincipal Jwt jwt) {
        UUID switchId = parse(id);
        // The patch is applied to the specs as stored and the result read as a whole, so a patch can
        // never leave a switch that a create would refuse. The photo comes from the patch alone.
        editSwitch.edit(switchId, ifMatch(ifMatch),
                (specs) -> new EditSwitch.Change(
                        SwitchSpecsReader.read(JsonMergePatch.apply(json.valueToTree(specs), patch)),
                        SwitchSpecsReader.photo(patch)),
                UserId.of(jwt).toString());
        return current(switchId);
    }

    @DeleteMapping("/{id}")
    ResponseEntity<Void> delete(@PathVariable String id,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch) {
        deleteSwitch.delete(parse(id), ifMatch(ifMatch));
        return ResponseEntity.noContent().build();
    }

    /** ADM-03: publish once the stock press and release are ready, else 409 missing_required_sounds. */
    @PostMapping(path = "/{id}/publication", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<AdminSwitch> publish(@PathVariable String id, @RequestBody(required = false) PublishInput body,
            @AuthenticationPrincipal Jwt jwt) {
        boolean markNew = body != null && Boolean.TRUE.equals(body.markNew());
        UUID switchId = parse(id);
        publishSwitch.publish(switchId, markNew, UserId.of(jwt).toString());
        return current(switchId);
    }

    /** ADM-03: pull from the public library; the switch stays for builds that use it. */
    @DeleteMapping("/{id}/publication")
    ResponseEntity<Void> unpublish(@PathVariable String id, @AuthenticationPrincipal Jwt jwt) {
        publishSwitch.unpublish(parse(id), UserId.of(jwt).toString());
        return ResponseEntity.noContent().build();
    }

    /** PublishInput in openapi-v1.yaml. */
    record PublishInput(Boolean markNew) {
    }

    /** The switch as it is now, with its ETag. */
    private ResponseEntity<AdminSwitch> current(UUID id) {
        SwitchRow sw = queries.get(id);
        return ResponseEntity.ok().cacheControl(PRIVATE).eTag(etag(sw)).body(view(sw));
    }

    static String etag(SwitchRow sw) {
        return ETags.of(sw.version());
    }

    /** 400 if_match_required without the header, 412 when it names another version. */
    private static VersionCheck ifMatch(String ifMatch) {
        return (version) -> IfMatch.check(ifMatch, ETags.of(version));
    }

    /** Anything that is not a UUID names no switch: 404, like an id that does not exist. */
    private static UUID parse(String id) {
        try {
            return UUID.fromString(id);
        }
        catch (IllegalArgumentException ex) {
            throw ApiProblem.of(ProblemTypes.NOT_FOUND, "switch_not_found", "No switch with this id");
        }
    }

    private AdminSwitch view(SwitchRow sw) {
        Instant now = clock.instant();
        return new AdminSwitch(sw.id(), sw.slug(), sw.name(), sw.brand(), sw.type(), sw.profile(), sw.stemColor(),
                sw.forceG(), sw.actuationMm(), sw.travelMm(), sw.soundStatus(), sw.isNew(now), sw.publishedAt(),
                sw.spring(), sw.housing(), sw.bottomOutG(), sw.forceCurve(), queries.sounds(sw.id()), sw.status(),
                sw.photoUrl());
    }

    /**
     * AdminSwitch in openapi-v1.yaml. Unset optional fields are left out.
     * {@code sounds} always comes, so the publish checklist can tick the stock
     * press and release one by one.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record AdminSwitch(UUID id, String slug, String name, String brand, String type, String profile,
            String stemColor, BigDecimal forceG, BigDecimal actuationMm, BigDecimal travelMm, String soundStatus,
            boolean isNew, Instant publishedAt, String spring, String housing, BigDecimal bottomOutG,
            List<CurvePoint> forceCurve, List<Recording> sounds, String status, String photoUrl) {
    }
}
