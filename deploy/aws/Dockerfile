# The SEDNA data service as an AWS Lambda container image. The AWS Lambda Web Adapter runs the same uvicorn
# server as locally and streams responses (no 6 MB limit). Build from the repository root:
#   docker build -f deploy/aws/Dockerfile -t sedna-api .
# Code written with AI assistance (Claude); see AI_USAGE.md.
FROM public.ecr.aws/docker/library/python:3.12-slim

COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter

WORKDIR /app
COPY service/requirements-lambda.txt service/requirements-lambda.txt
RUN pip install --no-cache-dir -r service/requirements-lambda.txt

# the code and the read-only data it ships with: the folded sky index and the wavelength map
COPY service/sedna service/sedna
COPY data/index/compact.npz data/index/compact.npz
COPY data/wavelength data/wavelength

# Lambda's file system is read-only except /tmp: caches (ours, astropy's, astroquery's) go there
ENV SEDNA_CACHE_DIR=/tmp/sedna-cache \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp \
    XDG_CONFIG_HOME=/tmp \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    AWS_LWA_PORT=8080 \
    AWS_LWA_READINESS_CHECK_PATH=/api/health \
    AWS_LWA_INVOKE_MODE=response_stream

WORKDIR /app/service
CMD ["python", "-m", "uvicorn", "sedna.api:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
