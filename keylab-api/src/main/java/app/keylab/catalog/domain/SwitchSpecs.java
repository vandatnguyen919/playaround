package app.keylab.catalog.domain;

import java.math.BigDecimal;
import java.util.List;

/**
 * What an editor writes about a switch (AdminSwitchInput in openapi-v1.yaml),
 * already checked by {@link SwitchSpecsValidator}. Optional fields are null
 * when unset; {@code forceCurve} is never null and is sorted by stroke, then
 * travel.
 */
public record SwitchSpecs(
        String name,
        String brand,
        SwitchType type,
        SoundProfile profile,
        String stemColor,
        BigDecimal forceG,
        BigDecimal actuationMm,
        BigDecimal travelMm,
        BigDecimal bottomOutG,
        String spring,
        String housing,
        List<ForceCurvePoint> forceCurve) {

    public enum SwitchType {
        linear, tactile, clicky, silent
    }

    public enum SoundProfile {
        deep, poppy, clacky, muted
    }
}
