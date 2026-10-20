package dev.playground.api;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.beans.factory.annotation.Autowired;

@SpringBootTest
@AutoConfigureMockMvc
@Import(UserControllerSecurityTest.MethodSecurityTestConfig.class)
class UserControllerSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private JwtDecoder jwtDecoder;

    @Test
    void anonymousCannotReadProfile() throws Exception {
        mockMvc.perform(get("/api/me"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void regularUserCanReadProfileButNotAdmin() throws Exception {
        mockMvc.perform(get("/api/me")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_user"))))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/admin")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_user"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void adminCanReadProfileAndAdminEndpoint() throws Exception {
        mockMvc.perform(get("/api/me")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_user"),
                        new SimpleGrantedAuthority("ROLE_admin"))))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/admin")
                .with(jwt().jwt(token -> token.claim("preferred_username", "admin"))
                        .authorities(new SimpleGrantedAuthority("ROLE_admin"))))
                .andExpect(status().isOk());
    }

    @TestConfiguration(proxyBeanMethods = false)
    @EnableMethodSecurity
    static class MethodSecurityTestConfig {
        @Bean
        Object methodSecurityMarker() {
            return new Object();
        }
    }
}
