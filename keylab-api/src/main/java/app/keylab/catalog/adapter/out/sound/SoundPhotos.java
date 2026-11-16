package app.keylab.catalog.adapter.out.sound;

import java.util.UUID;

import app.keylab.catalog.domain.SwitchPhotos;
import app.keylab.sound.SoundApi;

import org.springframework.stereotype.Component;

/** {@link SwitchPhotos} through the sound module, which owns uploads (US-38). Its 422s pass through as they are. */
@Component
class SoundPhotos implements SwitchPhotos {

    private final SoundApi sound;

    SoundPhotos(SoundApi sound) {
        this.sound = sound;
    }

    @Override
    public String use(UUID uploadId, String pointer) {
        return sound.usePhoto(uploadId, pointer);
    }
}
