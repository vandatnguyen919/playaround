package app.keylab.catalog.application;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import app.keylab.catalog.domain.SlugTaken;
import app.keylab.catalog.domain.Switch;
import app.keylab.catalog.domain.SwitchPhotos;
import app.keylab.catalog.domain.SwitchSpecs;
import app.keylab.catalog.domain.Switches;
import app.keylab.shared.Ids;

import org.jmolecules.architecture.hexagonal.PrimaryPort;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * ADM-02 create (US-37): every switch starts as a draft, which only editors
 * see. Not one transaction: when another editor takes the same slug a moment
 * earlier, the insert fails and a fresh slug is tried, which Postgres would
 * refuse inside a failed transaction.
 */
@PrimaryPort
@Service
public class AddSwitch {

    static final int SLUG_ATTEMPTS = 3;

    private final Switches switches;
    private final SwitchPhotos photos;
    private final Clock clock;

    @Autowired
    AddSwitch(Switches switches, SwitchPhotos photos) {
        this(switches, photos, Clock.systemUTC());
    }

    AddSwitch(Switches switches, SwitchPhotos photos, Clock clock) {
        this.switches = switches;
        this.photos = photos;
        this.clock = clock;
    }

    /**
     * @param editor the editor's user id
     * @return the new switch's id
     * @throws app.keylab.catalog.domain.InvalidSwitchSpecs when the specs break a rule
     */
    public UUID add(SwitchSpecs specs, PhotoChange photo, String editor) {
        specs.verify();
        String photoUrl = photo.changes() && photo.uploadId() != null
                ? photos.use(photo.uploadId(), "/photoUploadId") : null;
        UUID id = Ids.uuidV7();
        Instant now = clock.instant();
        for (int attempt = 1;; attempt++) {
            Switch sw = Switch.create(id, specs, switches::existsBySlug, editor, now);
            sw.changePhoto(photoUrl);
            try {
                switches.add(sw);
                return id;
            }
            catch (SlugTaken ex) {
                if (attempt == SLUG_ATTEMPTS) {
                    throw new IllegalStateException("No free slug after " + SLUG_ATTEMPTS + " attempts", ex);
                }
            }
        }
    }
}
