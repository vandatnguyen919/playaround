package app.keylab.testing;

import org.springframework.test.context.DynamicPropertyRegistry;

import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;

/**
 * One Postgres for the whole test run, the image dev and prod use
 * (infra/docker-compose.yml). Started on first use, removed by Testcontainers
 * when the JVM exits. Tests keep to their own rows; none drops a schema.
 */
public final class TestDatabase {

    public static final String IMAGE = "postgres:18.6-alpine";

    private static final GenericContainer<?> POSTGRES = new GenericContainer<>(IMAGE)
        .withEnv("POSTGRES_DB", "keylab")
        .withEnv("POSTGRES_USER", "keylab")
        .withEnv("POSTGRES_PASSWORD", "keylab")
        .withExposedPorts(5432)
        // Logged twice: once by the init run, once by the real server.
        .waitingFor(Wait.forLogMessage(".*database system is ready to accept connections.*\\s", 2));

    static {
        POSTGRES.start();
    }

    private TestDatabase() {
    }

    public static void register(DynamicPropertyRegistry registry) {
        registry.add("KEYLAB_DB_URL",
                () -> "jdbc:postgresql://" + POSTGRES.getHost() + ":" + POSTGRES.getMappedPort(5432) + "/keylab");
        registry.add("KEYLAB_DB_USERNAME", () -> "keylab");
        registry.add("KEYLAB_DB_PASSWORD", () -> "keylab");
    }
}
