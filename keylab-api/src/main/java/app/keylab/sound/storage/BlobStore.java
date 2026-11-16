package app.keylab.sound.storage;

import java.io.IOException;
import java.io.InputStream;
import java.util.Optional;

import org.springframework.core.io.Resource;

/**
 * Where uploaded and processed files live. Keys are paths such as
 * {@code uploads/<id>} or {@code sounds/<sha256>.wav}. The local adapter
 * writes to disk; an object store (Azure Blob, S3) can replace it without
 * touching the rest of the module.
 */
public interface BlobStore {

    /** Writes the whole stream under {@code key}, replacing what was there. */
    void put(String key, InputStream content) throws IOException;

    /** The stored file, or empty. */
    Optional<Resource> get(String key);

    /** Copies one key to another, unless the target exists (content-addressed keys never change). */
    void copy(String fromKey, String toKey) throws IOException;
}
