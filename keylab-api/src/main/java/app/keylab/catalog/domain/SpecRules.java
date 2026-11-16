package app.keylab.catalog.domain;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import app.keylab.catalog.domain.ForceCurvePoint.Stroke;
import app.keylab.catalog.domain.SwitchSpecs.SwitchType;

/**
 * The business rules of a switch's specs (ADM-02, US-37): what is required,
 * how long text may be, the ranges and precision of forces and distances,
 * actuation before the end of travel, and a force curve of at most 50 points
 * within the travel with no two points of one stroke at the same travel.
 *
 * <p>Each rule takes one field and adds a {@link Violation} when it breaks,
 * with the field's JSON Pointer, so a reader of the request can check the
 * fields one by one in the order of the form and still collect every problem
 * in one answer. {@link SwitchSpecs#verify()} runs all of them on specs that
 * are already built.
 */
public final class SpecRules {

    public static final int MAX_TEXT = 60;
    public static final int MAX_SHORT_TEXT = 40;
    public static final int MAX_POINTS = 50;

    static final BigDecimal MIN_FORCE = BigDecimal.valueOf(10);
    static final BigDecimal MAX_FORCE = BigDecimal.valueOf(150);
    static final BigDecimal MAX_CURVE_FORCE = BigDecimal.valueOf(250);
    static final BigDecimal MIN_TRAVEL = new BigDecimal("0.5");
    static final BigDecimal MAX_TRAVEL = new BigDecimal("6");
    static final BigDecimal MIN_ACTUATION = new BigDecimal("0.1");

    /** Also the message for a type that is not one of the four. */
    public static final String TYPE_MESSAGE = "Pick linear, tactile, clicky or silent.";

    private SpecRules() {
    }

    /** @param value the name, stripped, or null when there is none */
    public static String name(Violations v, String value) {
        return text(v, "/name", value, MAX_TEXT, true, "Give the switch a name.");
    }

    public static String brand(Violations v, String value) {
        return text(v, "/brand", value, MAX_TEXT, false, null);
    }

    public static String spring(Violations v, String value) {
        return text(v, "/spring", value, MAX_SHORT_TEXT, false, null);
    }

    public static String housing(Violations v, String value) {
        return text(v, "/housing", value, MAX_SHORT_TEXT, false, null);
    }

    /** Every switch has a type. */
    public static SwitchType type(Violations v, SwitchType type) {
        if (type == null) {
            v.add("/type", "required", TYPE_MESSAGE);
        }
        return type;
    }

    /** Actuation force, 10 to 150 g, to 0.1 g. */
    public static BigDecimal forceG(Violations v, BigDecimal value) {
        return number(v, "/forceG", value, MIN_FORCE, MAX_FORCE, 1, range(MIN_FORCE, MAX_FORCE, "g"));
    }

    /** Total travel, 0.5 to 6 mm, to 0.01 mm. */
    public static BigDecimal travelMm(Violations v, BigDecimal value) {
        return number(v, "/travelMm", value, MIN_TRAVEL, MAX_TRAVEL, 2, range(MIN_TRAVEL, MAX_TRAVEL, "mm"));
    }

    /** Actuation point, 0.1 to 6 mm, to 0.01 mm. */
    public static BigDecimal actuationMm(Violations v, BigDecimal value) {
        return number(v, "/actuationMm", value, MIN_ACTUATION, MAX_TRAVEL, 2, range(MIN_ACTUATION, MAX_TRAVEL, "mm"));
    }

    /** A switch actuates before it bottoms out. */
    public static void actuationBeforeTravel(Violations v, BigDecimal actuationMm, BigDecimal travelMm) {
        if (actuationMm != null && travelMm != null && actuationMm.compareTo(travelMm) >= 0) {
            v.add("/actuationMm", "actuation_after_travel", "Must be less than the total travel.");
        }
    }

    /** Bottom-out force, 10 to 250 g, to 0.1 g. */
    public static BigDecimal bottomOutG(Violations v, BigDecimal value) {
        return number(v, "/bottomOutG", value, MIN_FORCE, MAX_CURVE_FORCE, 1, range(MIN_FORCE, MAX_CURVE_FORCE, "g"));
    }

    /** @return false when the curve has too many points to check one by one */
    public static boolean curveSize(Violations v, int points) {
        if (points > MAX_POINTS) {
            v.add("/forceCurve", "too_many_points", "Keep it to " + MAX_POINTS + " points.");
            return false;
        }
        return true;
    }

    /** A point's travel: 0 up to the switch's total travel (6 mm when it has none), to 0.01 mm. */
    public static BigDecimal curveTravel(Violations v, String pointer, BigDecimal value, BigDecimal travelMm) {
        BigDecimal max = travelMm != null ? travelMm : MAX_TRAVEL;
        String message = travelMm != null ? "Between 0 and the total travel, " + travelMm.toPlainString() + " mm."
                : "Between 0 and " + MAX_TRAVEL.toPlainString() + " mm.";
        return number(v, pointer, value, BigDecimal.ZERO, max, 2, message);
    }

    /** A point's force: 0 to 250 g, to 0.1 g. */
    public static BigDecimal curveForce(Violations v, String pointer, BigDecimal value) {
        return number(v, pointer, value, BigDecimal.ZERO, MAX_CURVE_FORCE, 1,
                range(BigDecimal.ZERO, MAX_CURVE_FORCE, "g"));
    }

    /** Starts a force curve; points go in one by one with {@link Curve#add}. */
    public static Curve curve() {
        return new Curve();
    }

    /** A force curve being built: no two points of one stroke at the same travel; sorted by stroke, then travel. */
    public static final class Curve {

        private final List<ForceCurvePoint> points = new ArrayList<>();
        private final Set<String> seen = new HashSet<>();

        private Curve() {
        }

        /** @param travelPointer where a duplicate is reported, the point's {@code travelMm} */
        public void add(Violations v, String travelPointer, BigDecimal travelMm, BigDecimal forceG, Stroke stroke) {
            if (!seen.add(stroke + ":" + travelMm.toPlainString())) {
                v.add(travelPointer, "duplicate_travel",
                        "Another point already sits at " + travelMm.toPlainString() + " mm.");
                return;
            }
            points.add(new ForceCurvePoint(travelMm, forceG, stroke));
        }

        public List<ForceCurvePoint> points() {
            List<ForceCurvePoint> sorted = new ArrayList<>(points);
            sorted.sort(Comparator.comparing(ForceCurvePoint::stroke).thenComparing(ForceCurvePoint::travelMm));
            return List.copyOf(sorted);
        }
    }

    private static String text(Violations v, String pointer, String value, int max, boolean required,
            String requiredMessage) {
        if (value == null || value.isBlank()) {
            if (required) {
                v.add(pointer, "required", requiredMessage);
            }
            return null;
        }
        if (value.codePointCount(0, value.length()) > max) {
            v.add(pointer, "too_long", "Keep it to " + max + " characters.");
            return null;
        }
        return value;
    }

    /** Rounds to {@code scale} places, checks the range, and drops trailing zeros: 62.0 is 62, 100 never 1E+2. */
    private static BigDecimal number(Violations v, String pointer, BigDecimal value, BigDecimal min, BigDecimal max,
            int scale, String outOfRange) {
        if (value == null) {
            return null;
        }
        BigDecimal rounded = value.setScale(scale, RoundingMode.HALF_UP);
        if (rounded.compareTo(min) < 0 || rounded.compareTo(max) > 0) {
            v.add(pointer, "out_of_range", outOfRange);
            return null;
        }
        BigDecimal plain = rounded.stripTrailingZeros();
        return plain.scale() < 0 ? plain.setScale(0, RoundingMode.UNNECESSARY) : plain;
    }

    private static String range(BigDecimal min, BigDecimal max, String unit) {
        return "Between " + min.toPlainString() + " and " + max.toPlainString() + " " + unit + ".";
    }
}
