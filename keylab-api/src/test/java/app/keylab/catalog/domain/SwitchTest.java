package app.keylab.catalog.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import app.keylab.catalog.domain.SwitchSpecs.SwitchType;

import org.junit.jupiter.api.Test;

/** The rules of the {@link Switch} aggregate, without Spring or a database. */
class SwitchTest {

    private static final Instant T0 = Instant.parse("2026-11-01T10:00:00Z");
    private static final Instant T1 = Instant.parse("2026-11-05T10:00:00Z");
    private static final Instant T2 = Instant.parse("2026-11-09T10:00:00Z");
    private static final UUID ID = UUID.fromString("0190c0de-0000-7000-8000-000000000001");

    @Test
    void createsADraftWithNoSoundsAndASlugFromItsName() {
        Switch sw = Switch.create(ID, specs("Coral Pop"), (slug) -> false, "editor-1", T0);

        assertThat(sw.status()).isEqualTo(Status.DRAFT);
        assertThat(sw.soundStatus()).isEqualTo(SoundStatus.MISSING);
        assertThat(sw.slug()).isEqualTo("coral-pop");
        assertThat(sw.version()).isZero();
        assertThat(sw.isNew(T0)).isFalse();
        assertThat(sw.updatedBy()).isEqualTo("editor-1");
        assertThat(sw.events()).isEmpty();
    }

    @Test
    void takesTheNextFreeSlugWhenTheNameIsTaken() {
        Set<String> taken = Set.of("coral-pop", "coral-pop-2");

        Switch sw = Switch.create(ID, specs("Coral Pop"), taken::contains, "editor-1", T0);

        assertThat(sw.slug()).isEqualTo("coral-pop-3");
    }

    @Test
    void refusesSpecsThatBreakARule() {
        SwitchSpecs bad = new SwitchSpecs(" ", null, null, null, null, new BigDecimal("200"), new BigDecimal("4"),
                new BigDecimal("4"), null, null, null, List.of());

        assertThatThrownBy(() -> Switch.create(ID, bad, (slug) -> false, "editor-1", T0))
            .isInstanceOfSatisfying(InvalidSwitchSpecs.class, (ex) -> assertThat(ex.violations())
                .extracting(Violation::pointer, Violation::code)
                .containsExactly(pair("/name", "required"), pair("/type", "required"),
                        pair("/forceG", "out_of_range"), pair("/actuationMm", "actuation_after_travel")));
    }

    @Test
    void publishNeedsTheStockSoundsRecorded() {
        for (SoundStatus notReady : List.of(SoundStatus.MISSING, SoundStatus.PROCESSING)) {
            Switch sw = stored(Status.DRAFT, notReady, null, null);

            assertThatThrownBy(() -> sw.publish(true, T0, "editor-1")).isInstanceOf(MissingRequiredSounds.class);
            assertThat(sw.status()).isEqualTo(Status.DRAFT);
            assertThat(sw.events()).isEmpty();
        }
    }

    @Test
    void publishPutsTheSwitchInTheLibraryWithTheNewSticker() {
        Switch sw = stored(Status.DRAFT, SoundStatus.RECORDED, null, null);

        sw.publish(true, T0, "editor-2");

        assertThat(sw.status()).isEqualTo(Status.PUBLISHED);
        assertThat(sw.isPublished()).isTrue();
        assertThat(sw.publishedAt()).isEqualTo(T0);
        assertThat(sw.newUntil()).isEqualTo(T0.plus(Switch.NEW_FOR));
        assertThat(sw.isNew(T0.plus(Switch.NEW_FOR).minusSeconds(1))).isTrue();
        assertThat(sw.isNew(T0.plus(Switch.NEW_FOR))).isFalse();
        assertThat(sw.updatedBy()).isEqualTo("editor-2");
        assertThat(sw.events()).containsExactly(
                new SwitchEvent.Published(ID, "coral-pop", T0, T0.plus(Switch.NEW_FOR)));
    }

    @Test
    void publishWithoutMarkNewShowsNoSticker() {
        Switch sw = stored(Status.DRAFT, SoundStatus.RECORDED, null, null);

        sw.publish(false, T0, "editor-1");

        assertThat(sw.newUntil()).isNull();
        assertThat(sw.isNew(T0)).isFalse();
    }

    @Test
    void publishingAgainResetsTheNewStickerAndKeepsTheFirstPublishDate() {
        Switch sw = stored(Status.DRAFT, SoundStatus.RECORDED, null, null);
        sw.publish(true, T0, "editor-1");

        sw.publish(false, T1, "editor-1");
        assertThat(sw.newUntil()).isNull();
        assertThat(sw.publishedAt()).isEqualTo(T0);

        sw.publish(true, T2, "editor-1");
        assertThat(sw.newUntil()).isEqualTo(T2.plus(Switch.NEW_FOR));
        assertThat(sw.publishedAt()).isEqualTo(T0);
        assertThat(sw.events()).hasSize(3).allMatch(SwitchEvent.Published.class::isInstance);
    }

    @Test
    void unpublishHidesTheSwitchAndClearsTheSticker() {
        Switch sw = stored(Status.PUBLISHED, SoundStatus.RECORDED, T0, T0.plus(Switch.NEW_FOR));

        sw.unpublish(T1, "editor-3");

        assertThat(sw.status()).isEqualTo(Status.HIDDEN);
        assertThat(sw.newUntil()).isNull();
        assertThat(sw.publishedAt()).isEqualTo(T0);
        assertThat(sw.updatedBy()).isEqualTo("editor-3");
        assertThat(sw.events()).containsExactly(new SwitchEvent.Unpublished(ID, T1));
    }

    @Test
    void unpublishLeavesADraftOrAPulledSwitchAsItIs() {
        for (Status status : List.of(Status.DRAFT, Status.HIDDEN)) {
            Switch sw = stored(status, SoundStatus.RECORDED, null, null);

            sw.unpublish(T1, "editor-3");

            assertThat(sw.status()).isEqualTo(status);
            assertThat(sw.updatedBy()).isEqualTo("editor-1");
            assertThat(sw.events()).isEmpty();
        }
    }

    @Test
    void aPulledSwitchCanBePublishedAgain() {
        Switch sw = stored(Status.HIDDEN, SoundStatus.RECORDED, T0, null);

        sw.publish(true, T2, "editor-1");

        assertThat(sw.status()).isEqualTo(Status.PUBLISHED);
        assertThat(sw.publishedAt()).isEqualTo(T0);
        assertThat(sw.newUntil()).isEqualTo(T2.plus(Switch.NEW_FOR));
    }

    @Test
    void aDraftsSlugFollowsItsName() {
        Switch sw = stored(Status.DRAFT, SoundStatus.MISSING, null, null);

        sw.edit(specs("Coral Pop Pro"), Set.of("coral-pop-pro")::contains, "editor-2", T1);

        assertThat(sw.slug()).isEqualTo("coral-pop-pro-2");
        assertThat(sw.specs().name()).isEqualTo("Coral Pop Pro");
        assertThat(sw.updatedAt()).isEqualTo(T1);
        assertThat(sw.events()).containsExactly(new SwitchEvent.Edited(ID, "coral-pop-pro-2", T1));
    }

    @Test
    void aDraftKeepsItsSlugWhenTheNameOnlyChangesCase() {
        Switch sw = stored(Status.DRAFT, SoundStatus.MISSING, null, null);

        sw.edit(specs("CORAL pop"), (slug) -> true, "editor-2", T1);

        assertThat(sw.slug()).isEqualTo("coral-pop");
    }

    @Test
    void aPublishedSwitchKeepsItsSlugSoLinksKeepWorking() {
        Switch sw = stored(Status.PUBLISHED, SoundStatus.RECORDED, T0, null);

        sw.edit(specs("Coral Pop Pro"), (slug) -> false, "editor-2", T1);

        assertThat(sw.slug()).isEqualTo("coral-pop");
        assertThat(sw.specs().name()).isEqualTo("Coral Pop Pro");
    }

    @Test
    void anEditThatBreaksARuleChangesNothing() {
        Switch sw = stored(Status.DRAFT, SoundStatus.MISSING, null, null);

        assertThatThrownBy(() -> sw.edit(specs(""), (slug) -> false, "editor-2", T1))
            .isInstanceOf(InvalidSwitchSpecs.class);
        assertThat(sw.specs().name()).isEqualTo("Coral Pop");
        assertThat(sw.events()).isEmpty();
    }

    @Test
    void onlyDraftsCanBeDeleted() {
        stored(Status.DRAFT, SoundStatus.MISSING, null, null).delete();

        for (Status status : List.of(Status.PUBLISHED, Status.HIDDEN)) {
            Switch sw = stored(status, SoundStatus.RECORDED, T0, null);
            assertThatThrownBy(sw::delete).isInstanceOf(SwitchNotDraft.class);
        }
    }

    @Test
    void clearEventsEmptiesTheRecordedChanges() {
        Switch sw = stored(Status.DRAFT, SoundStatus.RECORDED, null, null);
        sw.publish(false, T0, "editor-1");

        sw.clearEvents();

        assertThat(sw.events()).isEmpty();
    }

    private static Switch stored(Status status, SoundStatus soundStatus, Instant publishedAt, Instant newUntil) {
        return Switch.restore(ID, "coral-pop", specs("Coral Pop"), status, soundStatus, newUntil, publishedAt, 4,
                T0.minusSeconds(60), "editor-1", null);
    }

    private static SwitchSpecs specs(String name) {
        return new SwitchSpecs(name, "KeyLab", SwitchType.linear, null, null, new BigDecimal("45"),
                new BigDecimal("2"), new BigDecimal("4"), null, null, null, List.of());
    }

    private static org.assertj.core.groups.Tuple pair(String pointer, String code) {
        return org.assertj.core.groups.Tuple.tuple(pointer, code);
    }
}
