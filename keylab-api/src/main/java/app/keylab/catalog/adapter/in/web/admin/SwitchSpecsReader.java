package app.keylab.catalog.adapter.in.web.admin;

import java.math.BigDecimal;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

import app.keylab.catalog.application.PhotoChange;
import app.keylab.catalog.domain.ForceCurvePoint;
import app.keylab.catalog.domain.ForceCurvePoint.Stroke;
import app.keylab.catalog.domain.InvalidSwitchSpecs;
import app.keylab.catalog.domain.SpecRules;
import app.keylab.catalog.domain.SwitchSpecs;
import app.keylab.catalog.domain.SwitchSpecs.SoundProfile;
import app.keylab.catalog.domain.SwitchSpecs.SwitchType;
import app.keylab.catalog.domain.Violations;

import tools.jackson.databind.JsonNode;

/**
 * Reads a switch from JSON (AdminSwitchInput), the whole body on a create
 * and the merged result on a PATCH. This class owns the shape of the request:
 * an object, text where text goes, numbers where numbers go, the words of
 * each choice, a hex colour, a UUID for the photo. The business rules
 * (required fields, lengths, ranges, the force curve) are the domain's
 * {@link SpecRules}, called field by field in the order of the form, so one
 * 422 lists every field to fix in that order. Read by hand rather than bound,
 * so a wrong type ("62g" for a number, "squishy" for a type) is a field error
 * too, not a 400.
 */
final class SwitchSpecsReader {

    private static final Pattern HEX = Pattern.compile("^#[0-9A-Fa-f]{6}$");

    private final Violations v = new Violations();

    private SwitchSpecsReader() {
    }

    /** @throws InvalidSwitchSpecs with one violation per field to fix */
    static SwitchSpecs read(JsonNode body) {
        return new SwitchSpecsReader().specs(body);
    }

    /**
     * {@code photoUploadId}: left out keeps the photo, null clears it, an id
     * takes that upload. Read once {@link #read} has passed, which checks it
     * is a UUID.
     */
    static PhotoChange photo(JsonNode body) {
        if (body == null || !body.has("photoUploadId")) {
            return PhotoChange.KEEP;
        }
        JsonNode node = body.get("photoUploadId");
        return node.isNull() ? PhotoChange.CLEAR : PhotoChange.use(UUID.fromString(node.asString()));
    }

    private SwitchSpecs specs(JsonNode body) {
        if (body == null || !body.isObject()) {
            v.add("", "invalid_body", "Send the switch as a JSON object.");
            v.throwIfAny();
        }
        String name = text(body, "name") ? SpecRules.name(v, string(body, "name")) : null;
        String brand = text(body, "brand") ? SpecRules.brand(v, string(body, "brand")) : null;
        SwitchType type = choice(body, "type", SwitchType.class, SpecRules.TYPE_MESSAGE);
        if (type == null && absent(body.get("type"))) {
            SpecRules.type(v, null);
        }
        SoundProfile profile = choice(body, "profile", SoundProfile.class, "Pick deep, poppy, clacky or muted.");
        String stemColor = stemColor(body);
        BigDecimal forceG = number(body.get("forceG"), "/forceG") ? SpecRules.forceG(v, decimal(body, "forceG"))
                : null;
        BigDecimal travelMm = number(body.get("travelMm"), "/travelMm")
                ? SpecRules.travelMm(v, decimal(body, "travelMm")) : null;
        BigDecimal actuationMm = number(body.get("actuationMm"), "/actuationMm")
                ? SpecRules.actuationMm(v, decimal(body, "actuationMm")) : null;
        SpecRules.actuationBeforeTravel(v, actuationMm, travelMm);
        BigDecimal bottomOutG = number(body.get("bottomOutG"), "/bottomOutG")
                ? SpecRules.bottomOutG(v, decimal(body, "bottomOutG")) : null;
        String spring = text(body, "spring") ? SpecRules.spring(v, string(body, "spring")) : null;
        String housing = text(body, "housing") ? SpecRules.housing(v, string(body, "housing")) : null;
        List<ForceCurvePoint> curve = forceCurve(body.get("forceCurve"), travelMm);
        JsonNode photo = body.get("photoUploadId");
        if (photo != null && !photo.isNull() && !isUuid(photo)) {
            // The upload itself is checked by the sound module once the specs pass.
            v.add("/photoUploadId", "upload_not_found", "No upload with this id.");
        }
        v.throwIfAny();
        return new SwitchSpecs(name, brand, type, profile, stemColor, forceG, actuationMm, travelMm, bottomOutG,
                spring, housing, curve);
    }

    /** True when the field is absent or text; a field of another type is an error here. */
    private boolean text(JsonNode body, String field) {
        JsonNode node = body.get(field);
        if (absent(node) || node.isString()) {
            return true;
        }
        v.add("/" + field, "invalid_type", "Enter text.");
        return false;
    }

    /** The text, stripped, or null when absent. */
    private static String string(JsonNode body, String field) {
        JsonNode node = body.get(field);
        return absent(node) ? null : node.stringValue().strip();
    }

    /** One of the enum's words, or null: absent (the rules decide if it is required) or not one of them (an error). */
    private <E extends Enum<E>> E choice(JsonNode body, String field, Class<E> type, String message) {
        JsonNode node = body.get(field);
        if (absent(node)) {
            return null;
        }
        if (node.isString()) {
            for (E candidate : type.getEnumConstants()) {
                if (candidate.name().equals(node.stringValue())) {
                    return candidate;
                }
            }
        }
        v.add("/" + field, "invalid_choice", message);
        return null;
    }

    private String stemColor(JsonNode body) {
        JsonNode node = body.get("stemColor");
        if (absent(node)) {
            return null;
        }
        if (!node.isString() || !HEX.matcher(node.stringValue().strip()).matches()) {
            v.add("/stemColor", "invalid_color", "Use a hex colour like #F16B53.");
            return null;
        }
        return node.stringValue().strip().toUpperCase(Locale.ROOT);
    }

    /** True when the field is a number for the rules to check; absent is false, another type is an error. */
    private boolean number(JsonNode node, String pointer) {
        if (absent(node)) {
            return false;
        }
        if (!node.isNumber()) {
            v.add(pointer, "invalid_type", "Enter a number.");
            return false;
        }
        return true;
    }

    private static BigDecimal decimal(JsonNode body, String field) {
        return body.get(field).decimalValue();
    }

    private List<ForceCurvePoint> forceCurve(JsonNode node, BigDecimal travelMm) {
        if (absent(node)) {
            return List.of();
        }
        if (!node.isArray()) {
            v.add("/forceCurve", "invalid_type", "Send the points as a list.");
            return List.of();
        }
        if (!SpecRules.curveSize(v, node.size())) {
            return List.of();
        }
        SpecRules.Curve curve = SpecRules.curve();
        for (int i = 0; i < node.size(); i++) {
            JsonNode point = node.get(i);
            String at = "/forceCurve/" + i;
            if (!point.isObject()) {
                v.add(at, "invalid_type", "Each point needs a travel and a force.");
                continue;
            }
            int before = v.size();
            BigDecimal travel = required(point.get("travelMm"), at + "/travelMm");
            BigDecimal force = required(point.get("forceG"), at + "/forceG");
            if (travel != null) {
                travel = SpecRules.curveTravel(v, at + "/travelMm", travel, travelMm);
            }
            if (force != null) {
                force = SpecRules.curveForce(v, at + "/forceG", force);
            }
            Stroke stroke = stroke(point.get("stroke"), at + "/stroke");
            if (v.size() > before || travel == null || force == null || stroke == null) {
                continue;
            }
            curve.add(v, at + "/travelMm", travel, force, stroke);
        }
        return curve.points();
    }

    /** A point's travel and force must be there, as numbers. */
    private BigDecimal required(JsonNode node, String pointer) {
        if (absent(node)) {
            v.add(pointer, "required", "Enter a number.");
            return null;
        }
        if (!node.isNumber()) {
            v.add(pointer, "invalid_type", "Enter a number.");
            return null;
        }
        return node.decimalValue();
    }

    /** Press when left out. */
    private Stroke stroke(JsonNode node, String pointer) {
        if (absent(node)) {
            return Stroke.press;
        }
        if (node.isString()) {
            for (Stroke candidate : Stroke.values()) {
                if (candidate.name().equals(node.stringValue())) {
                    return candidate;
                }
            }
        }
        v.add(pointer, "invalid_choice", "Pick press or release.");
        return null;
    }

    private static boolean absent(JsonNode node) {
        return node == null || node.isNull();
    }

    private static boolean isUuid(JsonNode node) {
        if (!node.isString()) {
            return false;
        }
        try {
            UUID.fromString(node.asString());
            return true;
        }
        catch (IllegalArgumentException ex) {
            return false;
        }
    }
}
