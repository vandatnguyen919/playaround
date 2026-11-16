package app.keylab.catalog.application;

import java.time.Clock;
import java.util.UUID;

import app.keylab.catalog.domain.Switch;
import app.keylab.catalog.domain.SwitchNotFound;
import app.keylab.catalog.domain.SwitchPhotos;
import app.keylab.catalog.domain.SwitchSpecs;
import app.keylab.catalog.domain.Switches;

import org.jmolecules.architecture.hexagonal.PrimaryPort;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * ADM-02 edit (US-37). The caller brings the precondition check and the patch
 * as functions, because both are about the request (If-Match, JSON Merge
 * Patch); this use case runs them against the switch it loaded, in the order
 * the API answers: unknown switch, then the precondition, then the specs.
 */
@PrimaryPort
@Service
public class EditSwitch {

    /** Checks the request was made against this version, else throws. */
    @PrimaryPort
    @FunctionalInterface
    public interface VersionCheck {
        void check(long currentVersion);
    }

    /** Turns the current specs into the new ones; throws InvalidSwitchSpecs when they break a rule. */
    @PrimaryPort
    @FunctionalInterface
    public interface SpecsPatch {
        Change apply(SwitchSpecs current);
    }

    /** The new specs and what happens to the photo. */
    @PrimaryPort
    public record Change(SwitchSpecs specs, PhotoChange photo) {
    }

    private final Switches switches;
    private final SwitchPhotos photos;
    private final Clock clock;

    @Autowired
    EditSwitch(Switches switches, SwitchPhotos photos) {
        this(switches, photos, Clock.systemUTC());
    }

    EditSwitch(Switches switches, SwitchPhotos photos, Clock clock) {
        this.switches = switches;
        this.photos = photos;
        this.clock = clock;
    }

    /**
     * @throws SwitchNotFound for an unknown id
     * @throws app.keylab.catalog.domain.InvalidSwitchSpecs when the patched specs break a rule
     * @throws app.keylab.catalog.domain.SwitchChangedMeanwhile when another edit got in first
     * @throws app.keylab.catalog.domain.SlugTaken when another switch took the new slug meanwhile
     */
    public void edit(UUID id, VersionCheck versionCheck, SpecsPatch patch, String editor) {
        Switch sw = switches.load(id).orElseThrow(SwitchNotFound::byId);
        versionCheck.check(sw.version());
        Change change = patch.apply(sw.specs());
        PhotoChange photo = change.photo();
        String photoUrl = photo.changes() && photo.uploadId() != null
                ? photos.use(photo.uploadId(), "/photoUploadId") : null;
        sw.edit(change.specs(), switches::existsBySlug, editor, clock.instant());
        if (photo.changes()) {
            sw.changePhoto(photoUrl);
        }
        switches.save(sw);
    }
}
