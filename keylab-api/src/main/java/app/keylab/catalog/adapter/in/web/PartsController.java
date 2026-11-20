package app.keylab.catalog.adapter.in.web;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import app.keylab.catalog.query.CaseOptionsView;
import app.keylab.catalog.query.KeycapSetRow;
import app.keylab.catalog.query.ModRow;
import app.keylab.catalog.query.ModRow.Effects;
import app.keylab.catalog.query.PartsCatalog;
import app.keylab.shared.paging.PageQuery;
import app.keylab.shared.web.PublicCache;

import com.fasterxml.jackson.annotation.JsonInclude;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * The builder's parts besides switches, open to guests (CAT-05 to CAT-08):
 * published keycap sets, live mods and active case options. Cached for 300 s
 * with an ETag, like the switch library.
 */
@RestController
class PartsController {

    private final PartsCatalog parts;
    private final PublicCache cache;

    PartsController(PartsCatalog parts, PublicCache cache) {
        this.parts = parts;
        this.cache = cache;
    }

    @GetMapping("/v1/keycap-sets")
    ResponseEntity<String> keycapSets(PageQuery page,
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        return cache.ok(parts.keycapSets(page).map(PartsController::keycapSet), ifNoneMatch);
    }

    @GetMapping("/v1/keycap-sets/{slug}")
    ResponseEntity<String> keycapSet(@PathVariable String slug,
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        return cache.ok(keycapSet(parts.keycapSet(slug)), ifNoneMatch);
    }

    @GetMapping("/v1/mods")
    ResponseEntity<String> mods(PageQuery page,
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        return cache.ok(parts.mods(page).map(PartsController::mod), ifNoneMatch);
    }

    @GetMapping("/v1/case-options")
    ResponseEntity<String> caseOptions(
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        CaseOptionsView view = parts.caseOptions();
        return cache.ok(new CaseOptions(view.materials().stream().map(PartsController::option).toList(),
                view.plates().stream().map(PartsController::option).toList(),
                view.mounts().stream().map(PartsController::option).toList()), ifNoneMatch);
    }

    static KeycapSet keycapSet(KeycapSetRow set) {
        return new KeycapSet(set.id(), set.slug(), set.name(), set.material(), set.profile(),
                new Colors(set.baseHex(), set.alphaHex(), set.modHex(), set.accentHex()), set.soundShift(),
                set.keyCount());
    }

    static Mod mod(ModRow mod) {
        return new Mod(mod.id(), mod.slug(), mod.name(), mod.description(), mod.levels(), mod.effects(), mod.live());
    }

    static CaseOption option(CaseOptionsView.Part part) {
        return new CaseOption(part.slug(), part.name(), part.colors(), part.note());
    }

    /** KeycapSet in openapi-v1.yaml. */
    record KeycapSet(UUID id, String slug, String name, String material, String profile, Colors colors,
            BigDecimal soundShift, int keys) {
    }

    record Colors(String base, String alpha, String mod, String accent) {
    }

    /** Mod in openapi-v1.yaml; {@code levels} is left out for a toggle mod. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Mod(UUID id, String slug, String name, String description, List<String> levels, Effects effects,
            boolean live) {
    }

    /** CaseOptions in openapi-v1.yaml. */
    record CaseOptions(List<CaseOption> materials, List<CaseOption> plates, List<CaseOption> mounts) {
    }

    /** One case material, plate or mount; {@code colors} only on materials. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record CaseOption(String slug, String name, List<String> colors, String soundEffect) {
    }
}
