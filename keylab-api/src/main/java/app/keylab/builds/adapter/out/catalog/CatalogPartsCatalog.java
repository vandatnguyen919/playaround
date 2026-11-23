package app.keylab.builds.adapter.out.catalog;

import app.keylab.builds.domain.KeycapLook;
import app.keylab.builds.domain.Parts;
import app.keylab.builds.domain.PartsCatalog;
import app.keylab.builds.domain.PartsReview;
import app.keylab.builds.domain.Sound;
import app.keylab.builds.domain.Violation;
import app.keylab.catalog.CatalogApi;
import app.keylab.catalog.CatalogApi.ModChoice;
import app.keylab.catalog.CatalogApi.PartsChoice;
import app.keylab.catalog.CatalogApi.Problem;

import org.springframework.stereotype.Component;

/**
 * {@link PartsCatalog} through {@link CatalogApi}: the catalog checks the
 * parts and composes their sound; this adapter puts each problem on the
 * field of the build body it belongs to.
 */
@Component
class CatalogPartsCatalog implements PartsCatalog {

    private final CatalogApi catalog;

    CatalogPartsCatalog(CatalogApi catalog) {
        this.catalog = catalog;
    }

    @Override
    public PartsReview review(Parts parts) {
        CatalogApi.PartsReview review = catalog.review(new PartsChoice(parts.switchSlug(), parts.variant(),
                parts.mods().stream().map((m) -> new ModChoice(m.slug(), m.level())).toList(), parts.keycapSet(),
                parts.caseMaterial(), parts.plate(), parts.mount()));
        if (!review.ok()) {
            return new PartsReview(review.problems().stream().map(CatalogPartsCatalog::violation).toList(), null,
                    null);
        }
        CatalogApi.Sound s = review.sound();
        KeycapLook keycaps = review.keycaps() == null ? null
                : new KeycapLook(review.keycaps().profile(), review.keycaps().material());
        return new PartsReview(java.util.List.of(), keycaps, new Sound(s.lowShelfDb(), s.highShelfDb(),
                s.reverbMix(), s.gainDb(), s.meterPosition(), s.meterWord()));
    }

    private static Violation violation(Problem problem) {
        String pointer = switch (problem.part()) {
            case SWITCH -> "/switch/slug";
            case MOD -> "/mods/" + problem.index();
            case KEYCAP_SET -> "/keycaps/set";
            case CASE_MATERIAL -> "/case/material";
            case PLATE -> "/case/plate";
            case MOUNT -> "/case/mount";
        };
        return new Violation(pointer, problem.code(), problem.message());
    }
}
