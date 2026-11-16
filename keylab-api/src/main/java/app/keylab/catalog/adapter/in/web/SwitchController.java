package app.keylab.catalog.adapter.in.web;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import app.keylab.catalog.query.Recording;
import app.keylab.catalog.query.SwitchLibrary;
import app.keylab.catalog.query.SwitchRow;
import app.keylab.catalog.query.SwitchRow.CurvePoint;
import app.keylab.shared.paging.PageQuery;
import app.keylab.shared.paging.PageResult;
import app.keylab.shared.web.PublicCache;

import com.fasterxml.jackson.annotation.JsonInclude;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The public switch library, open to guests (CAT-01 to CAT-04). Published
 * switches only; answers are cached for 300 s with an ETag.
 */
@RestController
@RequestMapping("/v1/switches")
class SwitchController {

    /** "Sounds similar" shows four. */
    static final int RELATED_DEFAULT = 4;

    private final SwitchLibrary library;
    private final PublicCache cache;

    SwitchController(SwitchLibrary library, PublicCache cache) {
        this.library = library;
        this.cache = cache;
    }

    @GetMapping
    ResponseEntity<String> list(PageQuery page,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String profile,
            @RequestParam(required = false) String sound,
            @RequestParam(required = false) String q,
            @RequestParam(name = "is_new", required = false) String isNew,
            @RequestParam(name = "force_min", required = false) String forceMin,
            @RequestParam(name = "force_max", required = false) String forceMax,
            @RequestParam(required = false) String sort,
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        Instant now = library.now();
        var filter = new LibraryParams(type, profile, sound, q, isNew, forceMin, forceMax, sort).toFilter();
        var result = library.list(filter, page).map((sw) -> summary(sw, now));
        return cache.ok(result, ifNoneMatch);
    }

    @GetMapping("/{slug}")
    ResponseEntity<String> get(@PathVariable String slug, @RequestParam(required = false) String include,
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        Set<String> embed = LibraryParams.includes(include);
        SwitchRow sw = library.published(slug);
        Instant now = library.now();
        List<Recording> sounds = embed.contains("sounds") ? library.sounds(sw) : null;
        List<SwitchSummary> related = embed.contains("related")
                ? library.related(sw, RELATED_DEFAULT).stream().map((r) -> summary(r, now)).toList()
                : null;
        return cache.ok(detail(sw, now, sounds, related), ifNoneMatch);
    }

    @GetMapping("/{slug}/sounds")
    ResponseEntity<String> sounds(@PathVariable String slug,
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        SwitchRow sw = library.published(slug);
        return cache.ok(new SwitchSounds(sw.soundStatus(), library.sounds(sw)), ifNoneMatch);
    }

    @GetMapping("/{slug}/related")
    ResponseEntity<String> related(@PathVariable String slug,
            @RequestParam(name = "page_size", required = false) String pageSize,
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        // One page only: the most similar few. page_size is checked like every other page.
        int size = pageSize == null ? RELATED_DEFAULT : PageQuery.parse(pageSize, null).pageSize();
        SwitchRow sw = library.published(slug);
        Instant now = library.now();
        List<SwitchSummary> data = library.related(sw, size).stream().map((r) -> summary(r, now)).toList();
        return cache.ok(new PageResult<>(data, new PageResult.PageInfo(null, size)), ifNoneMatch);
    }

    static SwitchDetail detail(SwitchRow sw, Instant now, List<Recording> sounds, List<SwitchSummary> related) {
        SwitchSummary b = summary(sw, now);
        SoundSummary soundSummary = sw.profile() == null ? null : new SoundSummary(sw.profile(), word(sw.profile()));
        return new SwitchDetail(b.id(), b.slug(), b.name(), b.brand(), b.type(), b.profile(), b.stemColor(),
                b.forceG(), b.actuationMm(), b.travelMm(), b.soundStatus(), b.isNew(), b.publishedAt(), sw.spring(),
                sw.housing(), sw.bottomOutG(), sw.forceCurve(), soundSummary, sounds, related);
    }

    /** soundSummary.word: the profile in a few words. */
    static String word(String profile) {
        return switch (profile) {
            case "deep" -> "Deep & rounded";
            case "poppy" -> "Bright & poppy";
            case "clacky" -> "Sharp & clacky";
            case "muted" -> "Soft & muted";
            default -> throw new IllegalStateException("Unknown sound profile " + profile);
        };
    }

    static SwitchSummary summary(SwitchRow sw, Instant now) {
        return new SwitchSummary(sw.id(), sw.slug(), sw.name(), sw.brand(), sw.type(), sw.profile(), sw.stemColor(),
                sw.forceG(), sw.actuationMm(), sw.travelMm(), sw.soundStatus(), sw.isNew(now), sw.publishedAt());
    }

    /** Switch in openapi-v1.yaml: a summary plus specs, curve, and what {@code include} asked for. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record SwitchDetail(UUID id, String slug, String name, String brand, String type, String profile,
            String stemColor, BigDecimal forceG, BigDecimal actuationMm, BigDecimal travelMm, String soundStatus,
            boolean isNew, Instant publishedAt, String spring, String housing, BigDecimal bottomOutG,
            List<CurvePoint> forceCurve, SoundSummary soundSummary, List<Recording> sounds,
            List<SwitchSummary> related) {
    }

    record SoundSummary(String profile, String word) {
    }

    /** SwitchSounds in openapi-v1.yaml. */
    record SwitchSounds(String soundStatus, List<Recording> data) {
    }

    /** SwitchSummary in openapi-v1.yaml. Unset optional fields are left out. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record SwitchSummary(UUID id, String slug, String name, String brand, String type, String profile,
            String stemColor, BigDecimal forceG, BigDecimal actuationMm, BigDecimal travelMm, String soundStatus,
            boolean isNew, Instant publishedAt) {
    }
}
