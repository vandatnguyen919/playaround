package app.keylab.sound.storage;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Optional;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;

/**
 * Blobs as files under {@code keylab.storage.root}. Writes go to a temporary
 * file first and are moved into place, so a reader never sees half a file.
 */
@Component
class FileSystemBlobStore implements BlobStore {

    /** Keys are built by this module, never from user input; this guards against a slip anyway. */
    private static final Pattern KEY = Pattern.compile("[a-z]+/[0-9a-f-]+(\\.[a-z0-9]+)?");

    private final Path root;

    FileSystemBlobStore(@Value("${keylab.storage.root}") Path root) throws IOException {
        this.root = Files.createDirectories(root.toAbsolutePath().normalize());
    }

    @Override
    public void put(String key, InputStream content) throws IOException {
        Path target = path(key);
        Files.createDirectories(target.getParent());
        Path temp = Files.createTempFile(target.getParent(), ".put-", ".tmp");
        try {
            Files.copy(content, temp, StandardCopyOption.REPLACE_EXISTING);
            Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        }
        finally {
            Files.deleteIfExists(temp);
        }
    }

    @Override
    public Optional<Resource> get(String key) {
        Path file = path(key);
        return Files.isRegularFile(file) ? Optional.of(new FileSystemResource(file)) : Optional.empty();
    }

    @Override
    public void copy(String fromKey, String toKey) throws IOException {
        Path target = path(toKey);
        if (Files.isRegularFile(target)) {
            return;
        }
        try (InputStream in = Files.newInputStream(path(fromKey))) {
            put(toKey, in);
        }
    }

    private Path path(String key) {
        if (!KEY.matcher(key).matches()) {
            throw new IllegalArgumentException("Not a blob key: " + key);
        }
        Path file = root.resolve(key).normalize();
        if (!file.startsWith(root)) {
            throw new IllegalArgumentException("Not a blob key: " + key);
        }
        return file;
    }
}
