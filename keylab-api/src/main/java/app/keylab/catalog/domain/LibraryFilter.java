package app.keylab.catalog.domain;

import java.math.BigDecimal;

/**
 * The public library's filters (CAT-01). Every field is optional; null means
 * "any".
 *
 * @param type linear, tactile, clicky or silent
 * @param profile deep, poppy, clacky or muted
 * @param sound "recorded", or "missing" for anything not yet playable
 * @param q words in the name or brand
 * @param isNew only switches showing the New sticker (true), or only those without it (false)
 * @param forceMin lowest actuation force in grams, inclusive
 * @param forceMax highest actuation force in grams, inclusive
 * @param sort popular, -publishedAt or force
 */
public record LibraryFilter(
        String type,
        String profile,
        String sound,
        String q,
        Boolean isNew,
        BigDecimal forceMin,
        BigDecimal forceMax,
        Sort sort) {

    public enum Sort {
        popular("popular"), newest("-publishedAt"), force("force");

        private final String wire;

        Sort(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        public static Sort fromWire(String value) {
            for (Sort sort : values()) {
                if (sort.wire.equals(value)) {
                    return sort;
                }
            }
            return null;
        }
    }
}
