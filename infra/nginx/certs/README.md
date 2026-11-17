# Local TLS material

`tls.crt` and `tls.key` here are a **self-signed pair for local operational acceptance only**. They
are deliberately short-lived (30 days) and are not a deployment artefact.

A real deployment mounts its own pair at the same paths:

    /etc/nginx/certs/tls.crt
    /etc/nginx/certs/tls.key

The nginx configuration does not change between the two cases, so "it worked locally" and "it works in
production" differ only in which files are mounted.

**Do not commit a real certificate or key here.** The files in this directory exist so the stack can be
started and exercised; they are worthless outside a laptop and would be actively dangerous if reused.
