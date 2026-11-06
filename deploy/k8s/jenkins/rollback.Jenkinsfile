// One click: back to the newest good release that is not running now, then smoke.
// Another click goes one further back, because the release left behind stops counting
// as good. History stays on the VM (vm-deploy.sh history) and in this job's builds.

def short12(String s) { return s.length() > 12 ? s.substring(0, 12) : s }

def notify(String subject) {
  withCredentials([
    usernamePassword(credentialsId: 'notify-smtp', usernameVariable: 'NOTIFY_USER', passwordVariable: 'NOTIFY_PASSWORD'),
    string(credentialsId: 'notify-recipient', variable: 'NOTIFY_TO'),
  ]) {
    withEnv(["NOTIFY_SUBJECT=${subject}"]) {
      sh 'sh deploy/k8s/jenkins/notify.sh'
    }
  }
}

node('deploy') {
  checkout scm
  withCredentials([sshUserPrivateKey(credentialsId: 'vm-deploy-key', keyFileVariable: 'VM_KEY')]) {
    sh 'sh deploy/k8s/jenkins/vm-ssh-config.sh'
    withEnv(["BY=${env.JOB_NAME}/${env.BUILD_NUMBER}"]) {
      def target = 'unknown'
      try {
        stage('Roll back') {
          timeout(time: 25, unit: 'MINUTES') {
            sh 'ssh "$VM_TARGET" rollback "$BY"'
          }
          target = sh(script: 'ssh "$VM_TARGET" current', returnStdout: true).trim()
          currentBuild.description = "to ${short12(target)}"
        }
        stage('Smoke') {
          timeout(time: 15, unit: 'MINUTES') {
            sh '/tools/node deploy/compose/smoke-public.mjs "$VM_TARGET" smoke'
          }
          sh 'ssh "$VM_TARGET" note "$(ssh "$VM_TARGET" current)" rollback-verified "$BY"'
        }
        notify("Rolled back by hand to ${short12(target)}: smoke passed")
      } catch (e) {
        notify("ROLLBACK PROBLEM: running ${target}, see the build log. The site may be down")
        throw e
      }
    }
  }
}
