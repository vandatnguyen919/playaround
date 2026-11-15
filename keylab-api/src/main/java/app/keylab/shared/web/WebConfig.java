package app.keylab.shared.web;

import java.util.List;

import app.keylab.shared.paging.PageQueryArgumentResolver;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Lets any controller take a {@code PageQuery} argument (page_size, page_token). */
@Configuration(proxyBeanMethods = false)
class WebConfig implements WebMvcConfigurer {

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new PageQueryArgumentResolver());
    }
}
