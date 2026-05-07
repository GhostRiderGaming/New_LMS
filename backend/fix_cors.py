import boto3
import os
from dotenv import load_dotenv

load_dotenv()

bucket_name = "catchupx-anime-assets"

s3 = boto3.client('s3',
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    region_name="us-east-1"
)

cors_configuration = {
    'CORSRules': [{
        'AllowedHeaders': ['*'],
        'AllowedMethods': ['GET', 'HEAD'],
        'AllowedOrigins': ['http://localhost:3000', 'http://localhost:3001', 'https://your-production-domain.com'],
        'ExposeHeaders': ['ETag'],
        'MaxAgeSeconds': 3000
    }]
}

try:
    s3.put_bucket_cors(Bucket=bucket_name, CORSConfiguration=cors_configuration)
    print(f"Successfully applied CORS to {bucket_name}")
except Exception as e:
    print(f"Failed to apply CORS: {e}")
