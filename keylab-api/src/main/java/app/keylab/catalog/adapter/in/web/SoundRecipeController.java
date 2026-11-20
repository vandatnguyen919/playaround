package app.keylab.catalog.adapter.in.web;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import jakarta.servlet.http.HttpServletRequest;

import app.keylab.catalog.application.ComposeSoundRecipe;
import app.keylab.catalog.domain.PartSounds.Take;
import app.keylab.catalog.domain.SoundMix;
import app.keylab.catalog.domain.SoundMix.ModPick;
import app.keylab.catalog.domain.SoundRecipe;
import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.ProblemTypes;
import app.keylab.shared.web.PublicCache;

import com.fasterxml.jackson.annotation.JsonInclude;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * BLD-10, the sound recipe for a parts mix, open to guests (US-05). Cached
 * like the catalog ({@code public, max-age=300} and an ETag), so the builder
 * can ask on every toggle. The answer does not depend on parameter order; the
 * client sorts the {@code mod} values so equal mixes share one cache entry.
 */
@RestController
class SoundRecipeController {

    static final Set<String> VARIANTS = Set.of("stock", "lubed", "foam");
    /** Single-valued parameters: giving one twice is a 400. */
    static final List<String> SINGLE = List.of("switch", "variant", "keycap_set", "case_material", "plate", "mount");
    private static final Pattern SLUG = Pattern.compile("[a-z0-9]+(?:-[a-z0-9]+)*");

    private final ComposeSoundRecipe recipes;
    private final PublicCache cache;

    SoundRecipeController(ComposeSoundRecipe recipes, PublicCache cache) {
        this.recipes = recipes;
        this.cache = cache;
    }

    @GetMapping("/v1/sound-recipe")
    ResponseEntity<String> recipe(HttpServletRequest request,
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        SoundRecipe recipe = recipes.compose(mix(request.getParameterMap()));
        return cache.ok(body(recipe), ifNoneMatch);
    }

    /** @throws ApiProblem 400 invalid_parameter for a malformed request */
    static SoundMix mix(Map<String, String[]> params) {
        for (String name : SINGLE) {
            String[] values = params.get(name);
            if (values != null && values.length > 1) {
                throw invalid(name + " is given more than once");
            }
        }
        String sw = single(params, "switch");
        if (sw == null) {
            throw invalid("switch is required");
        }
        String variant = single(params, "variant");
        if (variant == null) {
            variant = "stock";
        }
        else if (!VARIANTS.contains(variant)) {
            throw invalid("variant must be stock, lubed or foam");
        }
        return new SoundMix(sw, variant, mods(params.get("mod")), single(params, "keycap_set"),
                single(params, "case_material"), single(params, "plate"), single(params, "mount"));
    }

    private static String single(Map<String, String[]> params, String name) {
        String[] values = params.get(name);
        if (values == null || values.length == 0) {
            return null;
        }
        if (values[0].isBlank()) {
            throw invalid(name + " is empty");
        }
        return values[0];
    }

    /** Each value is {@code slug} or {@code slug:level}; one value per mod. */
    static List<ModPick> mods(String[] values) {
        List<ModPick> picks = new ArrayList<>();
        if (values == null) {
            return picks;
        }
        Set<String> seen = new HashSet<>();
        for (String value : values) {
            int colon = value.indexOf(':');
            String slug = colon < 0 ? value : value.substring(0, colon);
            String level = colon < 0 ? null : value.substring(colon + 1);
            if (!SLUG.matcher(slug).matches() || (level != null && !SLUG.matcher(level).matches())) {
                throw invalid("mod must be slug or slug:level, such as case-foam or lube:light");
            }
            if (!seen.add(slug)) {
                throw invalid("mod " + slug + " is given more than once");
            }
            picks.add(new ModPick(slug, level));
        }
        return picks;
    }

    private static ApiProblem invalid(String detail) {
        return ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_parameter", "A query parameter is not valid", detail);
    }

    static Recipe body(SoundRecipe recipe) {
        return new Recipe(recipe.samples().stream().map(SoundRecipeController::sample).toList(),
                new Filters(recipe.filters().lowShelfDb(), recipe.filters().highShelfDb(),
                        recipe.filters().reverbMix(), recipe.filters().gainDb()),
                new Meter(recipe.meter().position(), recipe.meter().word()));
    }

    private static Sample sample(Take take) {
        return new Sample(take.id(), take.variant(), take.stroke(), take.url(), take.durationMs(),
                take.loudnessLufs(), take.peaks());
    }

    /** SoundRecipe in openapi-v1.yaml. */
    record Recipe(List<Sample> samples, Filters filters, Meter meter) {
    }

    /** Recording in openapi-v1.yaml. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Sample(UUID id, String variant, String stroke, String url, Integer durationMs, BigDecimal loudnessLufs,
            List<Double> peaks) {
    }

    record Filters(double lowShelfDb, double highShelfDb, double reverbMix, double gainDb) {
    }

    record Meter(double position, String word) {
    }
}
