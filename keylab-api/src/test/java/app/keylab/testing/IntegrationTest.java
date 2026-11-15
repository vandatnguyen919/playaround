package app.keylab.testing;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The whole app against Postgres in Testcontainers and the stub JWKS: real
 * migrations, real security filters, real JWT checks. Subclasses share one
 * Spring context.
 */
@SpringBootTest
@AutoConfigureMockMvc
public abstract class IntegrationTest {

    @DynamicPropertySource
    static void infrastructure(DynamicPropertyRegistry registry) {
        TestDatabase.register(registry);
        StubJwks.register(registry);
    }

    @Autowired
    protected MockMvc mvc;

    protected static MockHttpServletRequestBuilder bearer(MockHttpServletRequestBuilder request, String token) {
        return request.header("Authorization", "Bearer " + token);
    }

    protected ResultActions getAs(String path, String token) throws Exception {
        return mvc.perform(bearer(get(path), token));
    }
}
