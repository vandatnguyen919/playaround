package dev.playground.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

// Throwaway: proves a failing test fails the PR. Never merge.
class CiGateTest {

    @Test
    void failsOnPurpose() {
        assertThat(1 + 1).isEqualTo(3);
    }
}
