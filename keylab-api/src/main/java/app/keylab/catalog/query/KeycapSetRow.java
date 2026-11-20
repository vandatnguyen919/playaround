package app.keylab.catalog.query;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * A keycap set as the builder sees it (CAT-05, CAT-06): material, profile,
 * colourway and the sound shift, -1 deeper to +1 brighter.
 */
public record KeycapSetRow(
        UUID id,
        String slug,
        String name,
        String material,
        String profile,
        String baseHex,
        String alphaHex,
        String modHex,
        String accentHex,
        BigDecimal soundShift,
        int keyCount,
        int position) {
}
