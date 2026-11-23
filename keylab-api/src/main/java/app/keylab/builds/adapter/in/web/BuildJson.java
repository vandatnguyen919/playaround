package app.keylab.builds.adapter.in.web;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import app.keylab.builds.application.BuildInput;
import app.keylab.builds.domain.InvalidBuild;
import app.keylab.builds.domain.Parts;
import app.keylab.builds.domain.Parts.ModChoice;
import app.keylab.builds.domain.Violation;
import app.keylab.builds.query.BuildRow;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import tools.jackson.databind.JsonNode;

/**
 * The build body on the wire (openapi-v1.yaml): BuildInput in, Build out.
 * Reading collects every field of the wrong JSON type before anything else
 * is checked, as one 422.
 */
final class BuildJson {

    private BuildJson() {
    }

    // --- In --------------------------------------------------------------------------

    /** @throws InvalidBuild when a field has the wrong JSON type */
    static BuildInput read(JsonNode body) {
        List<Violation> wrong = new ArrayList<>();
        if (body == null || !body.isObject()) {
            throw new InvalidBuild(List.of(new Violation("", "invalid_type", "Send the build as a JSON object.")));
        }
        String name = text(body, "/name", wrong);
        String visibility = text(body, "/visibility", wrong);
        String layout = text(body, "/layout", wrong);
        object(body, "/switch", wrong);
        String switchSlug = text(body, "/switch/slug", wrong);
        String variant = text(body, "/switch/variant", wrong);
        List<ModChoice> mods = new ArrayList<>();
        JsonNode modsNode = body.at("/mods");
        if (!modsNode.isMissingNode() && !modsNode.isNull()) {
            if (!modsNode.isArray()) {
                wrong.add(typeError("/mods", "a list"));
            }
            else {
                for (int i = 0; i < modsNode.size(); i++) {
                    String at = "/mods/" + i;
                    if (!modsNode.get(i).isObject()) {
                        wrong.add(typeError(at, "an object"));
                        continue;
                    }
                    mods.add(new ModChoice(text(body, at + "/slug", wrong), text(body, at + "/level", wrong)));
                }
            }
        }
        object(body, "/keycaps", wrong);
        String keycapSet = text(body, "/keycaps/set", wrong);
        object(body, "/case", wrong);
        String caseMaterial = text(body, "/case/material", wrong);
        String caseColor = text(body, "/case/color", wrong);
        String plate = text(body, "/case/plate", wrong);
        String mount = text(body, "/case/mount", wrong);
        String deskPad = text(body, "/deskPad", wrong);
        if (!wrong.isEmpty()) {
            throw new InvalidBuild(wrong);
        }
        return new BuildInput(name, visibility, new Parts(layout, switchSlug, variant, mods, keycapSet,
                caseMaterial, caseColor, plate, mount, deskPad));
    }

    /** A text field, or null when it is missing or null. */
    private static String text(JsonNode body, String pointer, List<Violation> wrong) {
        JsonNode node = body.at(pointer);
        if (node.isMissingNode() || node.isNull()) {
            return null;
        }
        if (!node.isString()) {
            wrong.add(typeError(pointer, "text"));
            return null;
        }
        return node.asString();
    }

    private static void object(JsonNode body, String pointer, List<Violation> wrong) {
        JsonNode node = body.at(pointer);
        if (!node.isMissingNode() && !node.isNull() && !node.isObject()) {
            wrong.add(typeError(pointer, "an object"));
        }
    }

    private static Violation typeError(String pointer, String expected) {
        return new Violation(pointer, "invalid_type", "Send " + expected + " here.");
    }

    /**
     * The build as it is, in the BuildInput shape a JSON Merge Patch applies
     * to. Fields the build does not have are left out.
     */
    static Map<String, Object> input(BuildInput input) {
        Parts p = input.parts();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", input.name());
        body.put("visibility", input.visibility());
        body.put("layout", p.layout());
        body.put("switch", Map.of("slug", p.switchSlug(), "variant", p.variant()));
        body.put("mods", p.mods().stream().map(BuildJson::mod).toList());
        if (p.keycapSet() != null) {
            body.put("keycaps", Map.of("set", p.keycapSet()));
        }
        Map<String, Object> kase = new LinkedHashMap<>();
        putIfSet(kase, "material", p.caseMaterial());
        putIfSet(kase, "color", p.caseColor());
        putIfSet(kase, "plate", p.plate());
        putIfSet(kase, "mount", p.mount());
        if (!kase.isEmpty()) {
            body.put("case", kase);
        }
        putIfSet(body, "deskPad", p.deskPad());
        return body;
    }

    private static Map<String, Object> mod(ModChoice mod) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("slug", mod.slug());
        putIfSet(m, "level", mod.level());
        return m;
    }

    private static void putIfSet(Map<String, Object> map, String key, String value) {
        if (value != null) {
            map.put(key, value);
        }
    }

    // --- Out -------------------------------------------------------------------------

    /**
     * Build in openapi-v1.yaml. Every endpoint here answers the caller about
     * their own builds, so {@code owner} is {@code me} (Conventions, IDs) until
     * profiles give members a username (US-16).
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record BuildView(UUID id, String name, String visibility, Owner owner, int likeCount, long version,
            Instant createdAt, Instant updatedAt, String layout, @JsonProperty("switch") SwitchPick switchPick,
            List<ModPick> mods, KeycapsPick keycaps, @JsonProperty("case") CasePick casePick, String deskPad) {
    }

    record Owner(String username) {
    }

    record SwitchPick(String slug, String variant) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record ModPick(String slug, String level) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record KeycapsPick(String set, String profile, String material) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    record CasePick(String material, String color, String plate, String mount) {
    }

    static BuildView view(BuildRow row) {
        boolean hasCase = row.caseMaterial() != null || row.caseColor() != null || row.plate() != null
                || row.mount() != null;
        return new BuildView(row.id(), row.name(), row.visibility(), new Owner("me"), 0, row.version(),
                row.createdAt(), row.updatedAt(), row.layout(), new SwitchPick(row.switchSlug(), row.variant()),
                row.mods().stream().map((m) -> new ModPick(m.slug(), m.level())).toList(),
                row.keycapSet() == null ? null
                        : new KeycapsPick(row.keycapSet(), row.keycapProfile(), row.keycapMaterial()),
                hasCase ? new CasePick(row.caseMaterial(), row.caseColor(), row.plate(), row.mount()) : null,
                row.deskPad());
    }
}
