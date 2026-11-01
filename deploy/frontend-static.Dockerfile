# Build with a release context containing dist/ and nginx.vm.conf.
# The frontend is compiled and tested before uploading this context to the VM.
FROM nginx:1.27-alpine
COPY nginx.vm.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY cloudflare-real-ip.conf /etc/nginx/cloudflare-real-ip.conf
COPY dist/ /usr/share/nginx/html/
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 8080 8443
CMD ["nginx", "-g", "daemon off;"]
