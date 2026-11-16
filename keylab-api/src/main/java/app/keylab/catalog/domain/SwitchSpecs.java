package app.keylab.catalog.domain;

import java.math.BigDecimal;
import java.util.List;

/**
 * What an editor writes about a switch (AdminSwitchInput in openapi-v1.yaml).
 * Optional fields are null when unset; {@code forceCurve} is never null and
 * is sorted by stroke, then travel. {@link #verify()} checks the business
 * rules ({@link SpecRules}); the aggregate calls it before it takes new specs.
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

    public SwitchSpecs {
        forceCurve = forceCurve == null ? List.of() : List.copyOf(forceCurve);
    }

    /**
     * Every rule at once, so one answer lists each field to fix.
     *
     * @throws InvalidSwitchSpecs with one violation per broken rule
     */
    public SwitchSpecs verify() {
        Violations v = new Violations();
        SpecRules.name(v, name);
        SpecRules.brand(v, brand);
        SpecRules.type(v, type);
        SpecRules.forceG(v, forceG);
        SpecRules.travelMm(v, travelMm);
        SpecRules.actuationMm(v, actuationMm);
        SpecRules.actuationBeforeTravel(v, actuationMm, travelMm);
        SpecRules.bottomOutG(v, bottomOutG);
        SpecRules.spring(v, spring);
        SpecRules.housing(v, housing);
        if (SpecRules.curveSize(v, forceCurve.size())) {
            SpecRules.Curve curve = SpecRules.curve();
            for (int i = 0; i < forceCurve.size(); i++) {
                ForceCurvePoint point = forceCurve.get(i);
                String at = "/forceCurve/" + i;
                BigDecimal travel = SpecRules.curveTravel(v, at + "/travelMm", point.travelMm(), travelMm);
                BigDecimal force = SpecRules.curveForce(v, at + "/forceG", point.forceG());
                if (travel != null && force != null && point.stroke() != null) {
                    curve.add(v, at + "/travelMm", travel, force, point.stroke());
                }
            }
        }
        v.throwIfAny();
        return this;
    }
}
