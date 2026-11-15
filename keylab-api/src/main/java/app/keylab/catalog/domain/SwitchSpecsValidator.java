package app.keylab.catalog.domain;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import app.keylab.catalog.domain.ForceCurvePoint.Stroke;
import app.keylab.catalog.domain.SwitchSpecs.SoundProfile;
import app.keylab.catalog.domain.SwitchSpecs.SwitchType;
import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.FieldError;

import tools.jackson.databind.JsonNode;

/**
 * Reads and checks a switch as JSON (AdminSwitchInput), the whole body on a
 * create and the merged result on a PATCH. Every problem is collected, so one
 * 422 lists each field to fix, with a JSON Pointer the form can put next to
 * the field. Read by hand rather than bound, so a wrong type ("62g" for a
 * number, "squishy" for a type) is a field error too, not a 400.
 */
public final class SwitchSpecsValidator {

    public static final int MAX_TEXT = 60;
    public static final int MAX_SHORT_TEXT = 40;
    public static final int MAX_POINTS = 50;

    static final BigDecimal MIN_FORCE = BigDecimal.valueOf(10);
    static final BigDecimal MAX_FORCE = BigDecimal.valueOf(150);
    static final BigDecimal MAX_CURVE_FORCE = BigDecimal.valueOf(250);
    static final BigDecimal MIN_TRAVEL = new BigDecimal("0.5");
    static final BigDecimal MAX_TRAVEL = new BigDecimal("6");
    static final BigDecimal MIN_ACTUATION = new BigDecimal("0.1");

    private static final Pattern HEX = Pattern.compile("^#[0-9A-Fa-f]{6}$");

    private final List<FieldError> errors = new ArrayList<>();

    private SwitchSpecsValidator() {
    }

    /** @throws ApiProblem 422 validation_failed with one entry per field to fix */
    public static SwitchSpecs validate(JsonNode body) {
        return new SwitchSpecsValidator().read(body);
    }

    private SwitchSpecs read(JsonNode body) {
        if (body == null || !body.isObject()) {
            throw ApiProblem.validation(List.of(new FieldError("", "invalid_body", "Send the switch as a JSON object.")));
        }
        String name = text(body, "name", MAX_TEXT, true, "Give the switch a name.");
        String brand = text(body, "brand", MAX_TEXT, false, null);
        SwitchType type = choice(body, "type", SwitchType.class, true, "Pick linear, tactile, clicky or silent.");
        SoundProfile profile = choice(body, "profile", SoundProfile.class, false,
                "Pick deep, poppy, clacky or muted.");
        String stemColor = stemColor(body);
        BigDecimal forceG = number(body, "/forceG", body.get("forceG"), MIN_FORCE, MAX_FORCE, 1, "g");
        BigDecimal travelMm = number(body, "/travelMm", body.get("travelMm"), MIN_TRAVEL, MAX_TRAVEL, 2, "mm");
        BigDecimal actuationMm = number(body, "/actuationMm", body.get("actuationMm"), MIN_ACTUATION, MAX_TRAVEL, 2,
                "mm");
        if (actuationMm != null && travelMm != null && actuationMm.compareTo(travelMm) >= 0) {
            error("/actuationMm", "actuation_after_travel", "Must be less than the total travel.");
        }
        BigDecimal bottomOutG = number(body, "/bottomOutG", body.get("bottomOutG"), MIN_FORCE, MAX_CURVE_FORCE, 1,
                "g");
        String spring = text(body, "spring", MAX_SHORT_TEXT, false, null);
        String housing = text(body, "housing", MAX_SHORT_TEXT, false, null);
        List<ForceCurvePoint> curve = forceCurve(body, travelMm);
        JsonNode photo = body.get("photoUploadId");
        if (photo != null && !photo.isNull()) {
            // Photos arrive through ADM-04 uploads, which do not exist yet, so no id can be valid.
            error("/photoUploadId", "photo_upload_unavailable", "Photo uploads are not available yet.");
        }
        if (!errors.isEmpty()) {
            throw ApiProblem.validation(errors);
        }
        return new SwitchSpecs(name, brand, type, profile, stemColor, forceG, actuationMm, travelMm, bottomOutG,
                spring, housing, curve);
    }

    private String text(JsonNode body, String field, int max, boolean required, String requiredMessage) {
        JsonNode node = body.get(field);
        String pointer = "/" + field;
        if (node == null || node.isNull()) {
            if (required) {
                error(pointer, "required", requiredMessage);
            }
            return null;
        }
        if (!node.isString()) {
            error(pointer, "invalid_type", "Enter text.");
            return null;
        }
        String value = node.stringValue().strip();
        if (value.isEmpty()) {
            if (required) {
                error(pointer, "required", requiredMessage);
            }
            return null;
        }
        if (value.codePointCount(0, value.length()) > max) {
            error(pointer, "too_long", "Keep it to " + max + " characters.");
            return null;
        }
        return value;
    }

    private <E extends Enum<E>> E choice(JsonNode body, String field, Class<E> type, boolean required,
            String message) {
        JsonNode node = body.get(field);
        if (node == null || node.isNull()) {
            if (required) {
                error("/" + field, "required", message);
            }
            return null;
        }
        if (node.isString()) {
            for (E candidate : type.getEnumConstants()) {
                if (candidate.name().equals(node.stringValue())) {
                    return candidate;
                }
            }
        }
        error("/" + field, "invalid_choice", message);
        return null;
    }

    private String stemColor(JsonNode body) {
        JsonNode node = body.get("stemColor");
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isString() || !HEX.matcher(node.stringValue().strip()).matches()) {
            error("/stemColor", "invalid_color", "Use a hex colour like #F16B53.");
            return null;
        }
        return node.stringValue().strip().toUpperCase(Locale.ROOT);
    }

    private BigDecimal number(JsonNode body, String pointer, JsonNode node, BigDecimal min, BigDecimal max, int scale,
            String unit) {
        return number(pointer, node, min, max, scale,
                "Between " + min.toPlainString() + " and " + max.toPlainString() + " " + unit + ".");
    }

    private BigDecimal number(String pointer, JsonNode node, BigDecimal min, BigDecimal max, int scale,
            String outOfRange) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isNumber()) {
            error(pointer, "invalid_type", "Enter a number.");
            return null;
        }
        BigDecimal value = node.decimalValue().setScale(scale, RoundingMode.HALF_UP);
        if (value.compareTo(min) < 0 || value.compareTo(max) > 0) {
            error(pointer, "out_of_range", outOfRange);
            return null;
        }
        // 62.0 is sent back as 62, and 100 never as 1E+2.
        BigDecimal plain = value.stripTrailingZeros();
        return plain.scale() < 0 ? plain.setScale(0, RoundingMode.UNNECESSARY) : plain;
    }

    private List<ForceCurvePoint> forceCurve(JsonNode body, BigDecimal travelMm) {
        JsonNode node = body.get("forceCurve");
        if (node == null || node.isNull()) {
            return List.of();
        }
        if (!node.isArray()) {
            error("/forceCurve", "invalid_type", "Send the points as a list.");
            return List.of();
        }
        if (node.size() > MAX_POINTS) {
            error("/forceCurve", "too_many_points", "Keep it to " + MAX_POINTS + " points.");
            return List.of();
        }
        BigDecimal maxTravel = travelMm != null ? travelMm : MAX_TRAVEL;
        List<ForceCurvePoint> points = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < node.size(); i++) {
            JsonNode point = node.get(i);
            String at = "/forceCurve/" + i;
            if (!point.isObject()) {
                error(at, "invalid_type", "Each point needs a travel and a force.");
                continue;
            }
            int before = errors.size();
            BigDecimal travel = required(point.get("travelMm"), at + "/travelMm");
            BigDecimal force = required(point.get("forceG"), at + "/forceG");
            if (travel != null) {
                travel = number(at + "/travelMm", point.get("travelMm"), BigDecimal.ZERO, maxTravel, 2,
                        travelMm != null ? "Between 0 and the total travel, " + travelMm.toPlainString() + " mm."
                                : "Between 0 and " + MAX_TRAVEL.toPlainString() + " mm.");
            }
            if (force != null) {
                force = number(point, at + "/forceG", point.get("forceG"), BigDecimal.ZERO, MAX_CURVE_FORCE, 1, "g");
            }
            Stroke stroke = Stroke.press;
            JsonNode strokeNode = point.get("stroke");
            if (strokeNode != null && !strokeNode.isNull()) {
                stroke = null;
                if (strokeNode.isString()) {
                    for (Stroke candidate : Stroke.values()) {
                        if (candidate.name().equals(strokeNode.stringValue())) {
                            stroke = candidate;
                        }
                    }
                }
                if (stroke == null) {
                    error(at + "/stroke", "invalid_choice", "Pick press or release.");
                }
            }
            if (errors.size() > before || travel == null || force == null || stroke == null) {
                continue;
            }
            if (!seen.add(stroke + ":" + travel.toPlainString())) {
                error(at + "/travelMm", "duplicate_travel", "Another point already sits at " + travel.toPlainString()
                        + " mm.");
                continue;
            }
            points.add(new ForceCurvePoint(travel, force, stroke));
        }
        points.sort(Comparator.comparing(ForceCurvePoint::stroke).thenComparing(ForceCurvePoint::travelMm));
        return List.copyOf(points);
    }

    /** A point's travel and force must be there; checked for range by {@link #number}. */
    private BigDecimal required(JsonNode node, String pointer) {
        if (node == null || node.isNull()) {
            error(pointer, "required", "Enter a number.");
            return null;
        }
        if (!node.isNumber()) {
            error(pointer, "invalid_type", "Enter a number.");
            return null;
        }
        return node.decimalValue();
    }

    private void error(String pointer, String code, String message) {
        errors.add(new FieldError(pointer, code, message));
    }
}
