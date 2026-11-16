package app.keylab.catalog.domain;

import java.util.UUID;

/**
 * Outbound port: catalog's copy of each switch's ready recordings, and the
 * sound status that follows from it ({@code catalog.switch_recordings}).
 */
public interface SwitchSounds {

    /**
     * Locks the switch until the transaction ends, so two recordings that
     * finish at once update its sound status one after the other.
     *
     * @return false when the switch is gone
     */
    boolean lock(UUID switchId);

    /** Keeps a ready recording, unless a later one for the same slot is already here (events may come late or twice). */
    void keep(ReadyRecording recording);

    /** Forgets a recording the sound module deleted (US-38). */
    void forget(UUID recordingId);

    /**
     * {@link SoundStatus#RECORDED} once the stock press and release are both
     * kept, else {@link SoundStatus#MISSING}. Not an editor's change, so the
     * switch's version (the admin ETag) stays.
     */
    void refreshSoundStatus(UUID switchId);
}
