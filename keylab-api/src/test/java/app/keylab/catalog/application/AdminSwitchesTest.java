package app.keylab.catalog.application;

import static org.assertj.core.api.Assertions.assertThat;

import app.keylab.shared.Ids;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class AdminSwitchesTest {

    final JsonMapper json = JsonMapper.builder().build();

    JsonNode read(String text) {
        return json.readTree(text);
    }

    @Test
    void mergePatchFollowsRfc7396() {
        JsonNode target = read("{ \"a\": \"b\", \"c\": { \"d\": \"e\", \"f\": \"g\" }, \"list\": [1, 2] }");
        JsonNode patch = read("{ \"a\": \"z\", \"c\": { \"f\": null }, \"list\": [3], \"n\": 1 }");
        assertThat(AdminSwitches.mergePatch(target, patch))
            .isEqualTo(read("{ \"a\": \"z\", \"c\": { \"d\": \"e\" }, \"list\": [3], \"n\": 1 }"));
        // The target is left as it was.
        assertThat(target.get("a").stringValue()).isEqualTo("b");
        // A patch that is not an object replaces the whole document.
        assertThat(AdminSwitches.mergePatch(target, read("[1]"))).isEqualTo(read("[1]"));
    }

    @Test
    void slugsAreLowerCaseAsciiWordsWithHyphens() {
        assertThat(AdminSwitches.slugBase("Coral Pop")).isEqualTo("coral-pop");
        assertThat(AdminSwitches.slugBase("  Gateron Milk Yellow Pro (V2)!  ")).isEqualTo("gateron-milk-yellow-pro-v2");
        assertThat(AdminSwitches.slugBase("Crème Brûlée")).isEqualTo("creme-brulee");
        assertThat(AdminSwitches.slugBase("静音")).isEqualTo("switch");
        assertThat(AdminSwitches.slugBase("a".repeat(30) + " " + "b".repeat(30))).hasSizeLessThanOrEqualTo(48)
            .doesNotEndWith("-");
    }

    @Test
    void idsAreUuidV7() {
        var id = Ids.uuidV7();
        assertThat(id.version()).isEqualTo(7);
        assertThat(id.variant()).isEqualTo(2);
        // The first 48 bits are the time in milliseconds.
        assertThat(id.getMostSignificantBits() >>> 16).isCloseTo(System.currentTimeMillis(),
                org.assertj.core.data.Offset.offset(5_000L));
    }
}
