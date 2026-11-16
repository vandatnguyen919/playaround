package app.keylab.catalog.application;

import java.text.Normalizer;
import java.time.Clock;
import java.time.Instant;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import app.keylab.catalog.domain.SlugTaken;
import app.keylab.catalog.domain.Switch;
import app.keylab.catalog.domain.SwitchChangedMeanwhile;
import app.keylab.catalog.domain.SwitchNotDraft;
import app.keylab.catalog.domain.SwitchNotFound;
import app.keylab.catalog.domain.SwitchSpecs;
import app.keylab.catalog.domain.SwitchSpecsValidator;
import app.keylab.catalog.persistence.SwitchRepository;
import app.keylab.catalog.query.InvalidPageToken;
import app.keylab.shared.Ids;
import app.keylab.shared.UserId;
import app.keylab.shared.concurrency.ETags;
import app.keylab.shared.concurrency.IfMatch;
import app.keylab.shared.paging.Cursor;
import app.keylab.shared.paging.PageQuery;
import app.keylab.shared.paging.PageResult;
import app.keylab.sound.SoundApi;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Create, read, edit and delete switches for editors (ADM-02, US-37). Every
 * switch is created as a draft, which only editors can see. Deleting is for
 * drafts only: a published switch may be in someone's build, so it is pulled
 * from the library (ADM-03) instead.
 */
@Service
public class AdminSwitches {

    static final int MAX_SLUG = 48;
    private static final int SLUG_ATTEMPTS = 3;

    private final SwitchRepository switches;
    private final SoundApi sound;
    private final JsonMapper json;
    private final Clock clock;

    @Autowired
    AdminSwitches(SwitchRepository switches, SoundApi sound, JsonMapper json) {
        this(switches, sound, json, Clock.systemUTC());
    }

    AdminSwitches(SwitchRepository switches, SoundApi sound, JsonMapper json, Clock clock) {
        this.switches = switches;
        this.sound = sound;
        this.json = json;
        this.clock = clock;
    }

    public static String etag(Switch sw) {
        return ETags.of(sw.version());
    }

    /**
     * ADM-02 list, drafts included, by name (the sound library's picker,
     * US-38). The type, status and sound filters and the bulk actions come
     * with US-36.
     *
     * @throws ApiProblem 400 invalid_page_token
     */
    public PageResult<Switch> list(String q, PageQuery page) {
        String afterName = null;
        UUID afterId = null;
        if (page.cursor() != null) {
            try {
                afterName = page.cursor().value(0);
                afterId = UUID.fromString(page.cursor().value(1));
            }
            catch (IllegalArgumentException ex) {
                throw new InvalidPageToken();
            }
        }
        String query = q == null || q.isBlank() ? null : q.strip();
        return PageResult.of(switches.listByName(query, afterName, afterId, page.limit()), page,
                (sw) -> Cursor.of(sw.specs().name().toLowerCase(java.util.Locale.ROOT), sw.id()));
    }

    /** @throws ApiProblem 404 switch_not_found */
    public Switch get(UUID id) {
        return switches.find(id).orElseThrow(AdminSwitches::notFound);
    }

    /** @throws ApiProblem 422 validation_failed */
    public Switch create(JsonNode body, UserId editor) {
        SwitchSpecs specs = SwitchSpecsValidator.validate(body);
        Photo photo = photo(body);
        UUID id = Ids.uuidV7();
        Instant now = clock.instant();
        for (int attempt = 1;; attempt++) {
            try {
                switches.insert(id, uniqueSlug(specs.name(), null), specs, editor.toString(), now);
                if (photo.changes()) {
                    switches.setPhoto(id, photo.url());
                }
                return get(id);
            }
            catch (DuplicateKeyException ex) {
                // Another editor took the same slug a moment ago: pick the next free one.
                if (attempt == SLUG_ATTEMPTS) {
                    throw ex;
                }
            }
        }
    }

    /**
     * Applies a JSON Merge Patch (RFC 7396) to the switch and checks the
     * result as a whole, so a patch can never leave a switch that a create
     * would refuse.
     *
     * @throws ApiProblem 404 switch_not_found, 400 if_match_required, 412 precondition_failed,
     *         422 validation_failed
     */
    public Switch update(UUID id, String ifMatch, JsonNode patch, UserId editor) {
        Switch current = get(id);
        IfMatch.check(ifMatch, etag(current));
        JsonNode merged = mergePatch(json.valueToTree(current.specs()), patch);
        SwitchSpecs specs = SwitchSpecsValidator.validate(merged);
        Photo photo = photo(patch);
        // A draft's slug follows its name; once published, links to it must keep working.
        boolean renamed = !slugBase(specs.name()).equals(slugBase(current.specs().name()));
        String slug = current.isDraft() && renamed ? uniqueSlug(specs.name(), current.slug()) : current.slug();
        try {
            if (!switches.update(id, current.version(), slug, specs, editor.toString(), clock.instant())) {
                throw new SwitchChangedMeanwhile();
            }
        }
        catch (DuplicateKeyException ex) {
            // Lost a race for the slug; the editor saves again and gets the next free one.
            throw new SlugTaken(ex);
        }
        if (photo.changes()) {
            switches.setPhoto(id, photo.url());
        }
        return get(id);
    }

    /**
     * @throws ApiProblem 404 switch_not_found, 400 if_match_required, 412 precondition_failed,
     *         409 switch_not_draft
     */
    public void delete(UUID id, String ifMatch) {
        Switch current = get(id);
        IfMatch.check(ifMatch, etag(current));
        if (!current.isDraft()) {
            throw new SwitchNotDraft();
        }
        if (!switches.deleteDraft(id, current.version())) {
            throw new SwitchChangedMeanwhile();
        }
    }

    /** What a create or patch says about the photo: nothing, clear it, or this new one. */
    private record Photo(boolean changes, String url) {
    }

    /**
     * {@code photoUploadId}: left out keeps the photo, null clears it, an id
     * takes that upload (a square PNG or JPG of at least 800 px, US-38).
     *
     * @throws ApiProblem 422 validation_failed at /photoUploadId
     */
    private Photo photo(JsonNode body) {
        if (body == null || !body.has("photoUploadId")) {
            return new Photo(false, null);
        }
        JsonNode node = body.get("photoUploadId");
        if (node.isNull()) {
            return new Photo(true, null);
        }
        return new Photo(true, sound.usePhoto(UUID.fromString(node.asString()), "/photoUploadId"));
    }

    /** RFC 7396: objects merge key by key, null removes, anything else (arrays too) replaces. */
    static JsonNode mergePatch(JsonNode target, JsonNode patch) {
        if (patch == null || !patch.isObject()) {
            return patch;
        }
        ObjectNode result = target != null && target.isObject() ? ((ObjectNode) target).deepCopy()
                : JsonMapper.builder().build().createObjectNode();
        for (Map.Entry<String, JsonNode> entry : patch.properties()) {
            if (entry.getValue().isNull()) {
                result.remove(entry.getKey());
            }
            else {
                result.set(entry.getKey(), mergePatch(result.get(entry.getKey()), entry.getValue()));
            }
        }
        return result;
    }

    /** "Coral Pop", "coral-pop-2" when taken; {@code own} is the switch's current slug, free to keep. */
    private String uniqueSlug(String name, String own) {
        String base = slugBase(name);
        Set<String> taken = new HashSet<>(switches.slugsStartingWith(base));
        if (own != null) {
            taken.remove(own);
        }
        if (!taken.contains(base)) {
            return base;
        }
        for (int n = 2;; n++) {
            String candidate = base + "-" + n;
            if (!taken.contains(candidate)) {
                return candidate;
            }
        }
    }

    /** Lower case ASCII words joined by hyphens: "Gateron Milk Yellow Pro" to "gateron-milk-yellow-pro". */
    static String slugBase(String name) {
        String ascii = Normalizer.normalize(name, Normalizer.Form.NFKD).replaceAll("\\p{M}+", "");
        String slug = ascii.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-+|-+$", "");
        if (slug.length() > MAX_SLUG) {
            slug = slug.substring(0, MAX_SLUG).replaceAll("-+$", "");
        }
        return slug.isEmpty() ? "switch" : slug;
    }

    private static SwitchNotFound notFound() {
        return SwitchNotFound.byId();
    }
}
