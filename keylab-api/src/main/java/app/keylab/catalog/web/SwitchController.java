package app.keylab.catalog.web;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import app.keylab.catalog.application.SwitchLibrary;
import app.keylab.catalog.domain.Switch;
import app.keylab.catalog.domain.SwitchSpecs;
import app.keylab.shared.paging.PageQuery;
import app.keylab.shared.web.PublicCache;

import com.fasterxml.jackson.annotation.JsonInclude;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The public switch library, open to guests (CAT-01). Published switches only;
 * answers are cached for 300 s with an ETag.
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

    static SwitchSummary summary(Switch sw, Instant now) {
        SwitchSpecs s = sw.specs();
        return new SwitchSummary(sw.id(), sw.slug(), s.name(), s.brand(), s.type().name(),
                s.profile() == null ? null : s.profile().name(), s.stemColor(), s.forceG(), s.actuationMm(),
                s.travelMm(), sw.soundStatus(), sw.newUntil() != null && sw.newUntil().isAfter(now),
                sw.publishedAt());
    }

    /** SwitchSummary in openapi-v1.yaml. Unset optional fields are left out. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record SwitchSummary(UUID id, String slug, String name, String brand, String type, String profile,
            String stemColor, BigDecimal forceG, BigDecimal actuationMm, BigDecimal travelMm, String soundStatus,
            boolean isNew, Instant publishedAt) {
    }
}
