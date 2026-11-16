package app.keylab.catalog.query;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One {@code catalog.switches} row as the read side shows it: the fields the
 * library, the switch page and the admin editor print, straight from SQL. It
 * is never turned into a {@code Switch} aggregate. {@code type},
 * {@code profile}, {@code status} and {@code soundStatus} are the stored
 * words, as the API sends them; {@code version} is the admin ETag.
 */
public record SwitchRow(
        UUID id,
        String slug,
        String name,
        String brand,
        String type,
        String profile,
        String stemColor,
        BigDecimal forceG,
        BigDecimal actuationMm,
        BigDecimal travelMm,
        BigDecimal bottomOutG,
        String spring,
        String housing,
        List<CurvePoint> forceCurve,
        String status,
        String soundStatus,
        Instant newUntil,
        Instant publishedAt,
        long version,
        Instant updatedAt,
        String photoUrl) {

    /** The New sticker shows until {@code newUntil}. */
    public boolean isNew(Instant now) {
        return newUntil != null && newUntil.isAfter(now);
    }

    /** One force curve point, as stored and as the API sends it (ForceCurvePoint in openapi-v1.yaml). */
    public record CurvePoint(BigDecimal travelMm, BigDecimal forceG, String stroke) {
    }
}
