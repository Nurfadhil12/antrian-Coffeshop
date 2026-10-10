# deployment/nginx/Dockerfile — Nginx + config sendiri
# Image dibangun hanya untuk membuang /etc/nginx/conf.d/default.conf bawaan,
# supaya server block kita (dari templates/app.conf.template) tidak bentrok di port 80.
ARG NGINX_VERSION=stable
FROM nginx:${NGINX_VERSION}-alpine

RUN rm -f /etc/nginx/conf.d/default.conf

# Struktur:
#   /etc/nginx/nginx.conf                   <- di-mount dari ./nginx/nginx.conf
#   /etc/nginx/templates/app.conf.template  <- di-mount dari ./nginx/templates
#                                              (envsubst -> conf.d/app.conf saat start)
#   /var/www/certbot                        <- volume bersama certbot (ACME challenge)
#   /etc/letsencrypt                        <- volume sertifikat
#
# Catatan: entrypoint image resmi hanya menjalankan 20-envsubst-on-templates.sh kalau
# command-nya dimulai dengan "nginx". Menguji dengan `docker run … sh -c 'nginx -t'`
# TIDAK me-render template apa pun, dan `nginx -t` akan lulus secara palsu.
