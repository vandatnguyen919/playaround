package app.keylab;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * One Spring Modulith app. Every direct sub-package is an application module
 * (docs/keylab/modulith-plan.md); ModularityTests keeps the boundaries.
 */
@SpringBootApplication
public class KeylabApplication {

    public static void main(String[] args) {
        SpringApplication.run(KeylabApplication.class, args);
    }
}
