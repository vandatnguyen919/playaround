package app.keylab.catalog.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import app.keylab.catalog.domain.MissingRequiredSounds;
import app.keylab.catalog.domain.SlugTaken;
import app.keylab.catalog.domain.SoundStatus;
import app.keylab.catalog.domain.Status;
import app.keylab.catalog.domain.Switch;
import app.keylab.catalog.domain.SwitchChangedMeanwhile;
import app.keylab.catalog.domain.SwitchEvent;
import app.keylab.catalog.domain.SwitchNotFound;
import app.keylab.catalog.domain.SwitchSpecs;
import app.keylab.catalog.domain.SwitchSpecs.SwitchType;
import app.keylab.catalog.domain.Switches;

import org.junit.jupiter.api.Test;

/** ADM-03 through the use case, with switches kept in memory: no Spring, no database. */
class PublishSwitchTest {

    private static final Instant NOW = Instant.parse("2026-11-16T09:00:00Z");
    private static final Instant EARLIER = Instant.parse("2026-10-01T09:00:00Z");
    private static final UUID ID = UUID.fromString("0190c0de-0000-7000-8000-000000000002");

    private final InMemorySwitches switches = new InMemorySwitches();
    private final PublishSwitch publishSwitch = new PublishSwitch(switches, Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void publishesADraftWhoseSoundsAreRecorded() {
        switches.put(stored(Status.DRAFT, SoundStatus.RECORDED, null, null));

        publishSwitch.publish(ID, true, "editor-1");

        Switch saved = switches.load(ID).orElseThrow();
        assertThat(saved.status()).isEqualTo(Status.PUBLISHED);
        assertThat(saved.publishedAt()).isEqualTo(NOW);
        assertThat(saved.newUntil()).isEqualTo(NOW.plus(Switch.NEW_FOR));
        assertThat(saved.updatedBy()).isEqualTo("editor-1");
        assertThat(saved.version()).isEqualTo(5);
        assertThat(switches.published)
            .containsExactly(new SwitchEvent.Published(ID, "coral-pop", NOW, NOW.plus(Switch.NEW_FOR)));
    }

    @Test
    void refusesWithoutTheStockSoundsAndStoresNothing() {
        switches.put(stored(Status.DRAFT, SoundStatus.MISSING, null, null));

        assertThatThrownBy(() -> publishSwitch.publish(ID, true, "editor-1"))
            .isInstanceOf(MissingRequiredSounds.class);

        Switch kept = switches.load(ID).orElseThrow();
        assertThat(kept.status()).isEqualTo(Status.DRAFT);
        assertThat(kept.version()).isEqualTo(4);
        assertThat(switches.published).isEmpty();
    }

    @Test
    void refusesWhenTheSoundsWentBetweenLoadAndSave() {
        switches.put(stored(Status.DRAFT, SoundStatus.RECORDED, null, null));
        switches.beforeSave = () -> switches.put(stored(Status.DRAFT, SoundStatus.PROCESSING, null, null));

        assertThatThrownBy(() -> publishSwitch.publish(ID, false, "editor-1"))
            .isInstanceOf(MissingRequiredSounds.class);
        assertThat(switches.load(ID).orElseThrow().status()).isEqualTo(Status.DRAFT);
    }

    @Test
    void publishingAgainResetsTheNewStickerAndKeepsTheFirstDate() {
        switches.put(stored(Status.PUBLISHED, SoundStatus.RECORDED, EARLIER, EARLIER.plus(Switch.NEW_FOR)));

        publishSwitch.publish(ID, false, "editor-2");

        Switch saved = switches.load(ID).orElseThrow();
        assertThat(saved.newUntil()).isNull();
        assertThat(saved.isNew(NOW)).isFalse();
        assertThat(saved.publishedAt()).isEqualTo(EARLIER);
    }

    @Test
    void anUnknownSwitchIsNotFound() {
        assertThatThrownBy(() -> publishSwitch.publish(ID, true, "editor-1"))
            .isInstanceOfSatisfying(SwitchNotFound.class,
                    (ex) -> assertThat(ex.lookup()).isEqualTo(SwitchNotFound.Lookup.ID));
        assertThatThrownBy(() -> publishSwitch.unpublish(ID, "editor-1")).isInstanceOf(SwitchNotFound.class);
    }

    @Test
    void unpublishPullsAPublishedSwitch() {
        switches.put(stored(Status.PUBLISHED, SoundStatus.RECORDED, EARLIER, EARLIER.plus(Switch.NEW_FOR)));

        publishSwitch.unpublish(ID, "editor-3");

        Switch saved = switches.load(ID).orElseThrow();
        assertThat(saved.status()).isEqualTo(Status.HIDDEN);
        assertThat(saved.newUntil()).isNull();
        assertThat(saved.publishedAt()).isEqualTo(EARLIER);
        assertThat(switches.published).containsExactly(new SwitchEvent.Unpublished(ID, NOW));
    }

    @Test
    void unpublishLeavesADraftUntouched() {
        switches.put(stored(Status.DRAFT, SoundStatus.MISSING, null, null));

        publishSwitch.unpublish(ID, "editor-3");

        Switch kept = switches.load(ID).orElseThrow();
        assertThat(kept.status()).isEqualTo(Status.DRAFT);
        assertThat(kept.version()).isEqualTo(4);
        assertThat(kept.updatedBy()).isEqualTo("editor-1");
        assertThat(switches.published).isEmpty();
    }

    private static Switch stored(Status status, SoundStatus soundStatus, Instant publishedAt, Instant newUntil) {
        SwitchSpecs specs = new SwitchSpecs("Coral Pop", "KeyLab", SwitchType.linear, null, null,
                new BigDecimal("45"), new BigDecimal("2"), new BigDecimal("4"), null, null, null, List.of());
        return Switch.restore(ID, "coral-pop", specs, status, soundStatus, newUntil, publishedAt, 4, EARLIER,
                "editor-1", null);
    }

    /**
     * {@link Switches} in a map. It keeps copies, as a database would, and
     * follows the same rules as the JDBC adapter: an edit only at the version
     * it was loaded at, a publish only while the stored sounds are recorded,
     * one version step per change, events published after the write.
     */
    static final class InMemorySwitches implements Switches {

        private final Map<UUID, Switch> rows = new HashMap<>();
        final List<SwitchEvent> published = new ArrayList<>();
        Runnable beforeSave = () -> {
        };

        void put(Switch sw) {
            rows.put(sw.id(), copy(sw, sw.version()));
        }

        @Override
        public Optional<Switch> load(UUID id) {
            return Optional.ofNullable(rows.get(id))
                .map((sw) -> copy(sw, sw.version()));
        }

        @Override
        public void add(Switch sw) {
            if (existsBySlug(sw.slug())) {
                throw new SlugTaken(null);
            }
            put(sw);
            flush(sw);
        }

        @Override
        public void save(Switch sw) {
            beforeSave.run();
            Switch row = rows.get(sw.id());
            long version = row.version();
            for (SwitchEvent event : sw.events()) {
                switch (event) {
                    case SwitchEvent.Edited edited -> {
                        if (row.version() != sw.version()) {
                            throw new SwitchChangedMeanwhile();
                        }
                    }
                    case SwitchEvent.Published p -> {
                        if (row.soundStatus() != SoundStatus.RECORDED) {
                            throw new MissingRequiredSounds();
                        }
                    }
                    case SwitchEvent.Unpublished u -> {
                    }
                }
                version++;
            }
            if (version != row.version()) {
                rows.put(sw.id(), copy(sw, version));
            }
            flush(sw);
        }

        @Override
        public void remove(Switch sw) {
            Switch row = rows.get(sw.id());
            if (row == null || row.version() != sw.version() || !row.isDraft()) {
                throw new SwitchChangedMeanwhile();
            }
            rows.remove(sw.id());
        }

        @Override
        public boolean existsBySlug(String slug) {
            return rows.values().stream().anyMatch((sw) -> sw.slug().equals(slug));
        }

        private void flush(Switch sw) {
            published.addAll(sw.events());
            sw.clearEvents();
        }

        private static Switch copy(Switch sw, long version) {
            return Switch.restore(sw.id(), sw.slug(), sw.specs(), sw.status(), sw.soundStatus(), sw.newUntil(),
                    sw.publishedAt(), version, sw.updatedAt(), sw.updatedBy(), sw.photoUrl());
        }
    }
}
