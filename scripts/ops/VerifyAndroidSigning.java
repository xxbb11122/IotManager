import java.io.File;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.SecureRandom;
import java.util.Arrays;

/** No credentials in arguments or output. Source-file launch requires JDK 17+. */
public class VerifyAndroidSigning {
    public static void main(String[] args) {
        char[] store = null, key = null;
        try {
            if (args.length != 1) throw new IllegalArgumentException();
            store = System.getenv("IOT_RELEASE_STORE_PASSWORD").toCharArray();
            key = System.getenv("IOT_RELEASE_KEY_PASSWORD").toCharArray();
            String alias = System.getenv("IOT_RELEASE_KEY_ALIAS");
            KeyStore ks = KeyStore.getInstance(new File(args[0]), store);
            if (!ks.isKeyEntry(alias)) throw new IllegalArgumentException();
            PrivateKey privateKey = (PrivateKey) ks.getKey(alias, key);
            byte[] challenge = new byte[32];
            new SecureRandom().nextBytes(challenge);
            Signature proof = Signature.getInstance("SHA256withRSA");
            proof.initSign(privateKey);
            proof.update(challenge);
            byte[] signed = proof.sign();
            proof.initVerify(ks.getCertificate(alias));
            proof.update(challenge);
            if (!proof.verify(signed)) throw new IllegalArgumentException();
            System.out.println("PRIVATE_KEY_VERIFIED");
        } catch (Exception error) {
            System.err.println("Signing key or credentials could not be verified.");
            System.exit(1);
        } finally {
            if (store != null) Arrays.fill(store, '\0');
            if (key != null) Arrays.fill(key, '\0');
        }
    }
}
