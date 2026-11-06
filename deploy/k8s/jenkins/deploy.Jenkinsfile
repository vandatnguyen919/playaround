// CD only. GitHub Actions tests and publishes images; this deploys one set of them.
// Runs on the deploy agent (values.yaml), checked out from the commit being deployed.
timeout(time: 75, unit: 'MINUTES') {
  node('deploy') {
    def tag

    stage('Checkout') {
      checkout scm
      def sha = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
      tag = env.DEPLOY_TAG_PIN ?: "sha-${sha}"
      echo "Deploying ${tag}"
    }

    withEnv(["IMAGE_TAG=${tag}"]) {
      container('helm') {
        // The poll sees a commit long before CI has published its images. A commit
        // whose CI failed never gets images, so it fails here and deploys nothing.
        stage('Wait for images') {
          sh 'sh deploy/k8s/jenkins/wait-for-images.sh "$IMAGE_TAG"'
        }

        stage('Deploy') {
          withCredentials([string(credentialsId: 'playground-deploy-token', variable: 'HELM_KUBETOKEN')]) {
            withEnv([
              'HELM_KUBEAPISERVER=https://kubernetes.default.svc',
              'HELM_KUBECAFILE=/run/kube-ca/ca.crt',
              'HELM_NAMESPACE=playground',
            ]) {
              // --atomic puts the previous release back if the rollout fails.
              sh '''
                set -eu
                if [ ! -d deploy/k8s/playground ]; then
                  echo "deploy/k8s/playground does not exist yet: the app chart is part of phase 2." >&2
                  exit 1
                fi
                helm upgrade --install playground deploy/k8s/playground \
                  --set-string imageTag="$IMAGE_TAG" \
                  --atomic --wait --timeout 10m
                helm status playground --show-desc
              '''
            }
          }
        }
      }
    }
  }
}
