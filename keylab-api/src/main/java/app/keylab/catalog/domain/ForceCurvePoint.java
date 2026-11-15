package app.keylab.catalog.domain;

import java.math.BigDecimal;

/**
 * One point of a switch's force curve: how hard (grams) at how far down
 * (millimetres), on the way down ({@code press}) or back up ({@code release}).
 */
public record ForceCurvePoint(BigDecimal travelMm, BigDecimal forceG, Stroke stroke) {

    public enum Stroke {
        press, release
    }
}
