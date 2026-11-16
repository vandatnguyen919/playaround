package app.keylab.catalog.query;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * A ready recording, as catalog keeps it (Recording in openapi-v1.yaml). The
 * sound module owns the file; catalog holds a copy of what the library plays.
 */
public record Recording(
        UUID id,
        String variant,
        String stroke,
        String url,
        Integer durationMs,
        BigDecimal loudnessLufs,
        List<Double> peaks) {

    /** The stock press and release are what a switch needs to be published (US-39). */
    public boolean isStock() {
        return "stock".equals(variant);
    }
}
