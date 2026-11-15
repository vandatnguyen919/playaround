package app.keylab.catalog.web;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import app.keylab.catalog.application.SwitchLibrary;
import app.keylab.catalog.domain.ForceCurvePoint;
import app.keylab.catalog.domain.Recording;
import app.keylab.catalog.domain.Switch;
import app.keylab.catalog.domain.SwitchSpecs;
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
        var result = library
            .list(new SwitchLibrary.Params(type, profile, sound, q, isNew, forceMin, forceMax, sort), page)
            .map((sw) -> summary(sw, now));
        return cache.ok(result, ifNoneMatch);
    }

    @GetMapping("/{slug}")
    ResponseEntity<String> get(@PathVariable String slug, @RequestParam(required = false) String include,
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        Set<String> embed = SwitchLibrary.includes(include);
        Switch sw = library.published(slug);
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
        Switch sw = library.published(slug);
        return cache.ok(new SwitchSounds(sw.soundStatus(), library.sounds(sw)), ifNoneMatch);
    }

    @GetMapping("/{slug}/related")
    ResponseEntity<String> related(@PathVariable String slug,
            @RequestParam(name = "page_size", required = false) String pageSize,
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        // One page only: the most similar few. page_size is checked like every other page.
        int size = pageSize == null ? RELATED_DEFAULT : PageQuery.parse(pageSize, null).pageSize();
        Switch sw = library.published(slug);
        Instant now = library.now();
        List<SwitchSummary> data = library.related(sw, size).stream().map((r) -> summary(r, now)).toList();
        return cache.ok(new PageResult<>(data, new PageResult.PageInfo(null, size)), ifNoneMatch);
    }

    /** "Sounds similar" shows four. */
    static final int RELATED_DEFAULT = 4;

    static SwitchDetail detail(Switch sw, Instant now, List<Recording> sounds, List<SwitchSummary> related) {
        SwitchSpecs s = sw.specs();
        SwitchSummary b = summary(sw, now);
        SoundSummary soundSummary = s.profile() == null ? null
                : new SoundSummary(s.profile().name(), word(s.profile()));
        return new SwitchDetail(b.id(), b.slug(), b.name(), b.brand(), b.type(), b.profile(), b.stemColor(),
                b.forceG(), b.actuationMm(), b.travelMm(), b.soundStatus(), b.isNew(), b.publishedAt(), s.spring(),
                s.housing(), s.bottomOutG(), s.forceCurve(), soundSummary, sounds, related);
    }

    /** soundSummary.word: the profile in a few words. */
    static String word(SwitchSpecs.SoundProfile profile) {
        return switch (profile) {
            case deep -> "Deep & rounded";
            case poppy -> "Bright & poppy";
            case clacky -> "Sharp & clacky";
            case muted -> "Soft & muted";
        };
    }

    static SwitchSummary summary(Switch sw, Instant now) {
        SwitchSpecs s = sw.specs();
        return new SwitchSummary(sw.id(), sw.slug(), s.name(), s.brand(), s.type().name(),
                s.profile() == null ? null : s.profile().name(), s.stemColor(), s.forceG(), s.actuationMm(),
                s.travelMm(), sw.soundStatus(), sw.newUntil() != null && sw.newUntil().isAfter(now),
                sw.publishedAt());
    }

    /** Switch in openapi-v1.yaml: a summary plus specs, curve, and what {@code include} asked for. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record SwitchDetail(UUID id, String slug, String name, String brand, String type, String profile,
            String stemColor, BigDecimal forceG, BigDecimal actuationMm, BigDecimal travelMm, String soundStatus,
            boolean isNew, Instant publishedAt, String spring, String housing, BigDecimal bottomOutG,
            List<ForceCurvePoint> forceCurve, SoundSummary soundSummary, List<Recording> sounds,
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
